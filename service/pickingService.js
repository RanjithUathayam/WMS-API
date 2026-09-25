const crypto = require('crypto');
const { sequelize } = require('../config/database');
const palletMappingRepository = require('../repository/palletMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const pickingRepository = require('../repository/pickingRepository');
const dcService = require('./dcService');
const sapStockTransferService = require('./sapStockTransferService');
const {
    PickingError, PICKABLE_STATUSES, isBlank, readString, readPalletNumber, readBoxNumber, readId,
    toQty, subtractQty, sumQty, pickableQty, sameCode, assertPalletPickable, toInventoryLineDto
} = require('./pickingCommon');

/** Warehouse pair eligible for Stock Transfer Request picking (the source query's filter). Overridable per deployment. */
const PICKLIST_FROM_WAREHOUSE = (process.env.PICKLIST_FROM_WAREHOUSE || 'INTRTHDL').trim();
const PICKLIST_TO_WAREHOUSE = (process.env.PICKLIST_TO_WAREHOUSE || 'INTRATTM').trim();

/** A Complete call that crashed mid-way releases its hold on the Pick List after this long. Must exceed the SAP timeout. */
const PROCESSING_LEASE_SECONDS = 300;
const MAX_DOCUMENTS_PER_PICKLIST = 50;

function userName(user) {
    return (user && user.UserName) || 'SYSTEM';
}

function sourceLineKey(docEntry, lineNum) {
    return `${Number(docEntry)}|${Number(lineNum)}`;
}

/* ================================================================================================
 * Legacy pallet picking (no Pick List) — POST /pick/pallet, /pick/box without pickListId, /pick/complete
 * ============================================================================================== */

function toPalletPickingDto(mapping, lines) {
    return {
        palletMappingId: mapping.PalletMappingID,
        palletId: mapping.PalletID,
        palletNumber: mapping.PalletID,
        palletStatus: mapping.Status,
        pickingStatus: mapping.PickingStatus || 'PENDING',
        boxNumbers: [...new Set(lines.map(l => l.BoxNumber))],
        items: lines.map(toInventoryLineDto)
    };
}

/** Scan Pallet — validates the pallet is available for picking and lists every still-pickable box/item on it. */
async function scanPalletAsync(rawRequest) {
    const palletNumber = readPalletNumber(rawRequest);
    if (isBlank(palletNumber)) {
        throw new PickingError('MISSING_FIELDS', 'palletNumber is required.');
    }

    const mapping = await palletMappingRepository.findMappingByPalletId(palletNumber);
    assertPalletPickable(mapping, palletNumber);

    const lines = await inventoryRepository.getAvailableInventoryByPallet(mapping.PalletMappingID);
    if (lines.length === 0) {
        throw new PickingError('PALLET_NOT_AVAILABLE', `Pallet ${palletNumber} has no items available for picking.`);
    }

    return toPalletPickingDto(mapping, lines);
}

/** Scan Box — validates the box exists, belongs to the scanned pallet, and still has pickable quantity. */
async function scanBoxAsync(rawRequest) {
    const palletNumber = readPalletNumber(rawRequest);
    const boxNumber = readBoxNumber(rawRequest);
    if (isBlank(palletNumber) || isBlank(boxNumber)) {
        throw new PickingError('MISSING_FIELDS', 'palletNumber (or palletId) and boxNumber are required.');
    }

    const mapping = await palletMappingRepository.findMappingByPalletId(palletNumber);
    assertPalletPickable(mapping, palletNumber);

    const boxLines = await inventoryRepository.getInventoryByPalletAndBox(mapping.PalletMappingID, boxNumber);
    if (boxLines.length === 0) {
        const existsElsewhere = await inventoryRepository.boxExistsInInventory(boxNumber);
        if (existsElsewhere) {
            throw new PickingError('BOX_NOT_IN_PALLET', `Box ${boxNumber} does not belong to pallet ${palletNumber}.`);
        }
        throw new PickingError('BOX_NOT_FOUND', `Box ${boxNumber} was not found.`);
    }

    const pickable = boxLines.filter(l => l.Status === 'AVAILABLE' && Number(l.Quantity) > 0);
    if (pickable.length === 0) {
        throw new PickingError('BOX_ALREADY_PICKED', `Box ${boxNumber} has already been picked.`);
    }

    return {
        palletMappingId: mapping.PalletMappingID,
        palletId: mapping.PalletID,
        palletNumber: mapping.PalletID,
        palletStatus: mapping.Status,
        pickingStatus: mapping.PickingStatus || 'PENDING',
        boxNumber,
        items: boxLines.map(toInventoryLineDto)
    };
}

function toPickingHistoryDto(row) {
    return {
        pickingId: row.PickingID,
        inventoryId: row.InventoryID,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        boxNumber: row.BoxNumber,
        itemCode: row.ItemCode,
        itemGroup: row.ItemGroup || null,
        warehouseCode: row.WarehouseCode || null,
        locationCode: row.LocationCode || null,
        pickedQty: Number(row.PickedQty),
        remainingQty: Number(row.RemainingQty),
        status: row.Status,
        pickedBy: row.PickedBy,
        pickedAt: row.PickedAt
    };
}

/** Throws the most specific "why isn't this (pallet, box, item) row there" error. */
async function throwMissingInventoryRow(palletMappingId, palletNumber, boxNumber, itemCode) {
    const boxLines = await inventoryRepository.getInventoryByPalletAndBox(palletMappingId, boxNumber);
    if (boxLines.length === 0) {
        const existsElsewhere = await inventoryRepository.boxExistsInInventory(boxNumber);
        if (existsElsewhere) {
            throw new PickingError('BOX_NOT_IN_PALLET', `Box ${boxNumber} does not belong to pallet ${palletNumber}.`);
        }
        throw new PickingError('BOX_NOT_FOUND', `Box ${boxNumber} was not found.`);
    }
    throw new PickingError('ITEM_NOT_FOUND', `Item ${itemCode} was not found on box ${boxNumber}.`);
}

/** Re-counts the pallet's remaining pickable rows (inside the caller's transaction) and rolls its PickingStatus forward. */
async function refreshPalletPickingStatus(transaction, palletMappingId) {
    const remainingAvailableCount = await inventoryRepository.countAvailableInventoryForPallet(transaction, palletMappingId);
    const status = remainingAvailableCount === 0 ? 'COMPLETED' : 'IN_PROGRESS';
    await pickingRepository.updatePalletPickingStatus(transaction, palletMappingId, status);
    return status;
}

/**
 * Complete Picking (legacy, no Pick List) — locks the pallet mapping row then the single
 * (pallet, box, item) inventory row, validates quantity, deducts stock, writes one T_PICKING_HISTORY
 * row, and rolls the pallet's PickingStatus forward, all in one transaction.
 */
async function completePickingAsync(rawRequest, user) {
    const palletNumber = readPalletNumber(rawRequest);
    const boxNumber = readBoxNumber(rawRequest);
    const itemCode = readString(rawRequest && rawRequest.itemCode);
    const pickedQuantity = rawRequest ? Number(rawRequest.pickedQuantity) : NaN;

    if (isBlank(palletNumber) || isBlank(boxNumber) || isBlank(itemCode)) {
        throw new PickingError('MISSING_FIELDS', 'palletNumber (or palletId), boxNumber (or boxId) and itemCode are required.');
    }
    if (!Number.isFinite(pickedQuantity) || pickedQuantity <= 0) {
        throw new PickingError('INVALID_PICKED_QUANTITY', 'pickedQuantity must be a positive number.');
    }
    const pickedBy = user && user.UserName;

    const result = await sequelize.transaction(async (transaction) => {
        const mapping = await palletMappingRepository.lockLatestMappingByPalletId(transaction, palletNumber);
        assertPalletPickable(mapping, palletNumber);

        const invRow = await inventoryRepository.lockInventoryRow(transaction, {
            palletMappingId: mapping.PalletMappingID, boxNumber, itemCode
        });
        if (!invRow) {
            await throwMissingInventoryRow(mapping.PalletMappingID, palletNumber, boxNumber, itemCode);
        }
        if (invRow.Status !== 'AVAILABLE' || Number(invRow.Quantity) <= 0) {
            throw new PickingError('BOX_ALREADY_PICKED', `Box ${boxNumber} / item ${itemCode} has already been picked.`);
        }
        if (pickedQuantity > Number(invRow.Quantity)) {
            throw new PickingError('INSUFFICIENT_INVENTORY', `Only ${Number(invRow.Quantity)} available for box ${boxNumber} / item ${itemCode}, cannot pick ${pickedQuantity}.`);
        }

        const remainingQty = Number(invRow.Quantity) - pickedQuantity;
        await inventoryRepository.deductInventoryQty(transaction, invRow.InventoryID, { remainingQty, updatedBy: pickedBy });

        const historyRow = await pickingRepository.insertPickingHistory(transaction, {
            inventoryId: invRow.InventoryID,
            palletMappingId: mapping.PalletMappingID,
            palletId: mapping.PalletID,
            boxNumber,
            itemCode,
            itemGroup: invRow.ItemGroup,
            warehouseCode: invRow.WarehouseCode,
            locationCode: invRow.LocationCode,
            pickedQty: pickedQuantity,
            remainingQty,
            pickedBy
        });

        const newPickingStatus = await refreshPalletPickingStatus(transaction, mapping.PalletMappingID);

        return {
            historyRow,
            palletMappingId: mapping.PalletMappingID,
            palletId: mapping.PalletID,
            palletStatus: mapping.Status,
            pickingStatus: newPickingStatus,
            boxNumber,
            itemCode,
            remainingQty,
            boxPickingStatus: remainingQty <= 0 ? 'PICKED' : 'PENDING'
        };
    });

    return {
        picking: toPickingHistoryDto(result.historyRow),
        pallet: {
            palletMappingId: result.palletMappingId,
            palletId: result.palletId,
            palletNumber: result.palletId,
            palletStatus: result.palletStatus,
            pickingStatus: result.pickingStatus
        },
        box: {
            boxNumber: result.boxNumber,
            itemCode: result.itemCode,
            remainingQty: result.remainingQty,
            pickingStatus: result.boxPickingStatus
        }
    };
}

/* ================================================================================================
 * Stock Transfer Request source lines
 * ============================================================================================== */

function toSourceLineDto(line, reservedQty) {
    const openQty = toQty(line.OpenQty);
    return {
        docEntry: line.DocEntry,
        docNum: line.DocNum,
        docDate: line.DocDate,
        docDueDate: line.DocDueDate,
        lineNum: line.LineNum,
        itemCode: line.ItemCode,
        itemName: line.ItemName,
        requestedQty: toQty(line.RequestedQty),
        openQty,
        reservedQty,
        availableForPickListQty: Math.max(subtractQty(openQty, reservedQty), 0),
        fromWarehouse: line.FromWarehouse,
        fromWarehouseName: line.FromWarehouseName,
        toWarehouse: line.ToWarehouse,
        toWarehouseName: line.ToWarehouseName,
        lineStatus: line.LineStatus
    };
}

function reservedMap(rows) {
    const map = new Map();
    for (const r of rows) map.set(sourceLineKey(r.SourceDocEntry, r.SourceLineNum), toQty(r.ReservedQty));
    return map;
}

/** GET /stock-transfer-requests — open STR lines for the configured warehouse pair, with what is still free to put on a Pick List. */
async function getStockTransferRequestLinesAsync(query = {}) {
    const lines = await pickingRepository.getOpenTransferRequestLines({
        fromWarehouse: PICKLIST_FROM_WAREHOUSE, toWarehouse: PICKLIST_TO_WAREHOUSE
    });
    const docEntries = [...new Set(lines.map(l => l.DocEntry))];
    const reserved = reservedMap(docEntries.length > 0 ? await pickingRepository.getReservedQtyBySourceLines(null, docEntries) : []);

    let dtos = lines.map(l => toSourceLineDto(l, reserved.get(sourceLineKey(l.DocEntry, l.LineNum)) || 0));
    const docNumFilter = readId(query.docNum);
    if (docNumFilter) dtos = dtos.filter(l => Number(l.docNum) === docNumFilter);
    if (String(query.onlyAvailable || '').toLowerCase() === 'true') dtos = dtos.filter(l => l.availableForPickListQty > 0);

    const documents = [];
    const byDoc = new Map();
    for (const l of dtos) {
        if (!byDoc.has(l.docEntry)) {
            const doc = {
                docEntry: l.docEntry, docNum: l.docNum, docDate: l.docDate, docDueDate: l.docDueDate,
                fromWarehouse: l.fromWarehouse, toWarehouse: l.toWarehouse,
                lineCount: 0, openQty: 0, availableForPickListQty: 0
            };
            byDoc.set(l.docEntry, doc);
            documents.push(doc);
        }
        const doc = byDoc.get(l.docEntry);
        doc.lineCount += 1;
        doc.openQty = sumQty([doc.openQty, l.openQty]);
        doc.availableForPickListQty = sumQty([doc.availableForPickListQty, l.availableForPickListQty]);
    }

    return {
        fromWarehouse: PICKLIST_FROM_WAREHOUSE,
        toWarehouse: PICKLIST_TO_WAREHOUSE,
        documents,
        lines: dtos
    };
}

/* ================================================================================================
 * Pick List creation
 * ============================================================================================== */

function parseDocuments(rawRequest) {
    const documents = rawRequest && rawRequest.documents;
    if (!Array.isArray(documents) || documents.length === 0) {
        throw new PickingError('MISSING_FIELDS', 'documents must be a non-empty array of { docEntry, docNum }.');
    }
    if (documents.length > MAX_DOCUMENTS_PER_PICKLIST) {
        throw new PickingError('TOO_MANY_DOCUMENTS', `A Pick List can combine at most ${MAX_DOCUMENTS_PER_PICKLIST} documents.`);
    }
    const seen = new Map();
    for (const doc of documents) {
        const docEntry = readId(doc && doc.docEntry);
        const docNum = readId(doc && doc.docNum);
        if (!docEntry || !docNum) {
            throw new PickingError('INVALID_DOCUMENT', 'Every document needs a positive integer docEntry and docNum.');
        }
        if (seen.has(docEntry) && seen.get(docEntry) !== docNum) {
            throw new PickingError('INVALID_DOCUMENT', `DocEntry ${docEntry} was sent with two different DocNums.`);
        }
        seen.set(docEntry, docNum);
    }
    return [...seen.entries()].map(([docEntry, docNum]) => ({ docEntry, docNum }));
}

function toPickListDetailDto(d) {
    return {
        pickListDetailId: d.PickListDetailID,
        sourceDocEntry: d.SourceDocEntry,
        sourceDocNum: d.SourceDocNum,
        sourceLineNum: d.SourceLineNum,
        itemCode: d.ItemCode,
        itemName: d.ItemName,
        sourceOpenQty: d.SourceOpenQty !== undefined ? Number(d.SourceOpenQty) : undefined,
        requestedQty: Number(d.RequestedQty),
        pickedQty: Number(d.PickedQty),
        remainingQty: Number(d.RemainingQty),
        fromWarehouse: d.FromWarehouse,
        toWarehouse: d.ToWarehouse,
        status: d.Status
    };
}

function toPickListHeaderDto(h) {
    return {
        pickListId: h.PickListID,
        pickListNumber: h.PickListNumber,
        status: h.Status,
        fromWarehouse: h.FromWarehouse,
        toWarehouse: h.ToWarehouse,
        totalRequestedQty: h.TotalRequestedQty !== undefined ? Number(h.TotalRequestedQty) : undefined,
        totalPickedQty: h.TotalPickedQty !== undefined ? Number(h.TotalPickedQty) : undefined,
        createdBy: h.CreatedBy,
        createdDate: h.CreatedDate,
        completedBy: h.CompletedBy || null,
        completedDate: h.CompletedDate || null,
        dcNumber: h.DCNumber || null,
        stockTransferDocEntry: h.StockTransferDocEntry || null,
        stockTransferNumber: h.StockTransferNumber || null,
        lastError: h.LastErrorStage ? { stage: h.LastErrorStage, message: h.LastErrorMessage, date: h.LastErrorDate } : null,
        retryCount: h.RetryCount !== undefined ? Number(h.RetryCount) : undefined,
        lineCount: h.LineCount !== undefined ? Number(h.LineCount) : undefined,
        sourceDocNums: h.SourceDocNums ? String(h.SourceDocNums).split(',').map(Number) : undefined
    };
}

/**
 * POST /picklist — one Pick List from one or more STR documents.
 * Everything is re-read from SAP inside the transaction (the request only names the documents), and
 * creation is serialized with an application lock so the same remaining quantity can never be put on
 * two Pick Lists. Each detail keeps the source DocEntry / DocNum / LineNum.
 */
async function createPickListAsync(rawRequest, user) {
    const documents = parseDocuments(rawRequest);
    const docEntries = documents.map(d => d.docEntry);
    const createdBy = userName(user);

    return sequelize.transaction(async (transaction) => {
        const locked = await pickingRepository.acquirePickListCreationLock(transaction);
        if (!locked) {
            throw new PickingError('PICKLIST_BUSY', 'Another Pick List is being generated. Please retry.');
        }

        const headers = await pickingRepository.getTransferRequestHeaders(docEntries, transaction);
        const headerByEntry = new Map(headers.map(h => [Number(h.DocEntry), h]));
        for (const doc of documents) {
            const h = headerByEntry.get(doc.docEntry);
            if (!h) {
                throw new PickingError('DOCUMENT_NOT_FOUND', `Stock Transfer Request DocEntry ${doc.docEntry} was not found.`);
            }
            if (Number(h.DocNum) !== doc.docNum) {
                throw new PickingError('INVALID_DOCUMENT', `DocEntry ${doc.docEntry} is DocNum ${h.DocNum}, not ${doc.docNum}.`);
            }
            if (h.Canceled === 'Y' || h.DocStatus === 'C') {
                throw new PickingError('DOCUMENT_CLOSED', `Stock Transfer Request ${doc.docNum} is closed or cancelled.`);
            }
        }

        const lines = await pickingRepository.getOpenTransferRequestLines({
            fromWarehouse: PICKLIST_FROM_WAREHOUSE, toWarehouse: PICKLIST_TO_WAREHOUSE, docEntries, transaction
        });
        const reserved = reservedMap(await pickingRepository.getReservedQtyBySourceLines(transaction, docEntries));

        const candidates = [];
        for (const doc of documents) {
            const docLines = lines.filter(l => Number(l.DocEntry) === doc.docEntry);
            if (docLines.length === 0) {
                throw new PickingError('NO_OPEN_LINES',
                    `Stock Transfer Request ${doc.docNum} has no open lines from ${PICKLIST_FROM_WAREHOUSE} to ${PICKLIST_TO_WAREHOUSE}.`);
            }
            let docRemaining = 0;
            for (const l of docLines) {
                const openQty = toQty(l.OpenQty);
                const reservedQty = reserved.get(sourceLineKey(l.DocEntry, l.LineNum)) || 0;
                const remaining = subtractQty(openQty, reservedQty);
                if (remaining <= 0) continue;
                docRemaining = sumQty([docRemaining, remaining]);
                candidates.push({ line: l, openQty, requestedQty: remaining });
            }
            if (docRemaining <= 0) {
                throw new PickingError('DUPLICATE_PICKLIST',
                    `The remaining quantity of Stock Transfer Request ${doc.docNum} is already on another Pick List.`);
            }
        }

        const header = await pickingRepository.insertPickListHeader(transaction, {
            fromWarehouse: PICKLIST_FROM_WAREHOUSE,
            toWarehouse: PICKLIST_TO_WAREHOUSE,
            totalRequestedQty: sumQty(candidates.map(c => c.requestedQty)),
            createdBy
        });

        const details = [];
        for (const c of candidates) {
            details.push(await pickingRepository.insertPickListDetail(transaction, {
                pickListId: header.PickListID,
                sourceDocEntry: c.line.DocEntry,
                sourceDocNum: c.line.DocNum,
                sourceLineNum: c.line.LineNum,
                sourceDocDate: c.line.DocDate,
                sourceDocDueDate: c.line.DocDueDate,
                itemCode: c.line.ItemCode,
                itemName: c.line.ItemName,
                sourceOpenQty: c.openQty,
                requestedQty: c.requestedQty,
                fromWarehouse: c.line.FromWarehouse,
                toWarehouse: c.line.ToWarehouse
            }));
        }

        return { ...toPickListHeaderDto(header), details: details.map(toPickListDetailDto) };
    });
}

/* ================================================================================================
 * Pick List queries
 * ============================================================================================== */

async function listPickListsAsync(query = {}) {
    const rows = await pickingRepository.listPickLists({
        status: isBlank(query.status) ? null : String(query.status).trim().toUpperCase(),
        limit: query.limit
    });
    return rows.map(toPickListHeaderDto);
}

async function getPickListAsync(pickListId) {
    const id = readId(pickListId);
    if (!id) throw new PickingError('MISSING_FIELDS', 'A valid pickListId is required.');
    const header = await pickingRepository.findPickListById(id);
    if (!header) throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${id} was not found.`);

    const [details, transactions, processLog, dc] = await Promise.all([
        pickingRepository.getPickListDetails(id),
        pickingRepository.getPickTransactions(id),
        pickingRepository.getProcessLog(id),
        dcService.getDCForPickList(id)
    ]);

    return {
        ...toPickListHeaderDto(header),
        stockTransferDocNum: header.StockTransferDocNum || null,
        details: details.map(toPickListDetailDto),
        transactions: transactions.map(t => ({
            pickTransactionId: t.PickTransactionID,
            pickListDetailId: t.PickListDetailID,
            sourceDocEntry: t.SourceDocEntry,
            sourceDocNum: t.SourceDocNum,
            sourceLineNum: t.SourceLineNum,
            itemCode: t.ItemCode,
            warehouse: t.Warehouse,
            location: t.Location,
            palletMappingId: t.PalletMappingID,
            palletNumber: t.PalletNumber,
            boxId: t.BoxID,
            boxNumber: t.BoxNumber,
            availableQty: Number(t.AvailableQty),
            pickQty: Number(t.PickQty),
            createdBy: t.CreatedBy,
            createdDate: t.CreatedDate
        })),
        dc,
        processLog: processLog.map(l => ({
            stage: l.Stage, result: l.Result, message: l.Message, createdBy: l.CreatedBy, createdDate: l.CreatedDate
        }))
    };
}

/* ================================================================================================
 * Save Pick Transaction
 * ============================================================================================== */

function parsePickRequest(rawRequest) {
    const pickListId = readId(rawRequest && rawRequest.pickListId);
    const pickListDetailId = readId(rawRequest && rawRequest.pickListDetailId);
    const itemCode = readString(rawRequest && rawRequest.itemCode);
    const palletNumber = readPalletNumber(rawRequest);
    const boxNumber = readBoxNumber(rawRequest);
    const location = readString(rawRequest && (rawRequest.location || rawRequest.locationCode));
    const clientRequestId = readString(rawRequest && rawRequest.clientRequestId) || null;

    if (!pickListId || !pickListDetailId || isBlank(itemCode) || isBlank(palletNumber) || isBlank(boxNumber) || isBlank(location)) {
        throw new PickingError('MISSING_FIELDS', 'pickListId, pickListDetailId, itemCode, palletNumber, boxNumber and location are required.');
    }
    const rawQty = rawRequest.pickQty;
    const pickQty = toQty(rawQty);
    if (rawQty === null || rawQty === undefined || rawQty === '' || !Number.isFinite(pickQty) || pickQty <= 0) {
        throw new PickingError('INVALID_PICK_QTY', 'pickQty must be a positive number.');
    }
    if (clientRequestId && clientRequestId.length > 100) {
        throw new PickingError('INVALID_REQUEST', 'clientRequestId must be at most 100 characters.');
    }
    return { pickListId, pickListDetailId, itemCode, palletNumber, boxNumber, location, pickQty, clientRequestId };
}

function toSavedPickDto(saved) {
    return {
        pickListId: saved.pickListId,
        pickListDetailId: saved.pickListDetailId,
        pickTransactionId: saved.pickTransactionId,
        itemCode: saved.itemCode,
        pickQty: saved.pickQty,
        pickedQty: saved.pickedQty,
        remainingQty: saved.remainingQty,
        detailStatus: saved.detailStatus,
        pickListStatus: saved.pickListStatus,
        pickListCompletedPicking: saved.pickListStatus === 'PICKED',
        source: saved.source,
        palletNumber: saved.palletNumber,
        palletPickingStatus: saved.palletPickingStatus,
        boxNumber: saved.boxNumber,
        location: saved.location,
        inventoryRemainingQty: saved.inventoryRemainingQty,
        duplicate: !!saved.duplicate
    };
}

async function duplicatePickResult(req) {
    const existing = await pickingRepository.findPickTransactionByClientRequestId(req.pickListId, req.clientRequestId);
    if (!existing) return null;
    return toSavedPickDto({
        pickListId: existing.PickListID,
        pickListDetailId: existing.PickListDetailID,
        pickTransactionId: existing.PickTransactionID,
        itemCode: existing.ItemCode,
        pickQty: Number(existing.PickQty),
        remainingQty: Number(existing.RemainingQty),
        duplicate: true
    });
}

/**
 * POST /pick — the only mutating picking step for Pick Lists. One transaction, fixed lock order
 * (Pick List header -> detail -> pallet mapping -> inventory row). Every quantity is re-read under lock;
 * the request's quantities are only the operator's intent.
 */
async function savePickTransactionAsync(rawRequest, user) {
    const req = parsePickRequest(rawRequest);
    const createdBy = userName(user);

    if (req.clientRequestId) {
        const duplicate = await duplicatePickResult(req);
        if (duplicate) return duplicate;
    }

    try {
        const saved = await sequelize.transaction(async (transaction) => {
            const header = await pickingRepository.lockPickListById(transaction, req.pickListId);
            if (!header) {
                throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${req.pickListId} was not found.`);
            }
            if (!PICKABLE_STATUSES.includes(header.Status)) {
                throw new PickingError('PICKLIST_CLOSED', `Pick List ${header.PickListNumber} is ${header.Status}; no more picks are allowed.`);
            }

            const detail = await pickingRepository.lockPickListDetail(transaction, req.pickListDetailId);
            if (!detail || Number(detail.PickListID) !== Number(header.PickListID)) {
                throw new PickingError('ITEM_NOT_IN_PICKLIST', `Line ${req.pickListDetailId} does not belong to Pick List ${header.PickListNumber}.`);
            }
            if (!sameCode(detail.ItemCode, req.itemCode)) {
                throw new PickingError('ITEM_NOT_IN_PICKLIST', `Item ${req.itemCode} does not match Pick List line ${req.pickListDetailId} (${detail.ItemCode}).`);
            }
            const remainingRequired = toQty(detail.RemainingQty);
            if (remainingRequired <= 0) {
                throw new PickingError('LINE_ALREADY_PICKED', `Item ${detail.ItemCode} of STR ${detail.SourceDocNum} line ${detail.SourceLineNum} is already fully picked.`);
            }
            if (req.pickQty > remainingRequired) {
                throw new PickingError('PICK_QTY_EXCEEDS_REMAINING', `Only ${remainingRequired} of ${detail.ItemCode} is still required; cannot pick ${req.pickQty}.`);
            }

            const mapping = await palletMappingRepository.lockLatestMappingByPalletId(transaction, req.palletNumber);
            assertPalletPickable(mapping, req.palletNumber);

            const invRow = await inventoryRepository.lockInventoryRow(transaction, {
                palletMappingId: mapping.PalletMappingID, boxNumber: req.boxNumber, itemCode: detail.ItemCode
            });
            if (!invRow) {
                await throwMissingInventoryRow(mapping.PalletMappingID, req.palletNumber, req.boxNumber, detail.ItemCode);
            }
            if (!sameCode(invRow.WarehouseCode, detail.FromWarehouse)) {
                throw new PickingError('WAREHOUSE_MISMATCH', `Box ${req.boxNumber} is in warehouse ${invRow.WarehouseCode}; this Pick List picks from ${detail.FromWarehouse}.`);
            }
            if (!sameCode(invRow.LocationCode, req.location)) {
                throw new PickingError('LOCATION_MISMATCH', `Pallet ${req.palletNumber} is at location ${invRow.LocationCode}, not ${req.location}.`);
            }
            const availableQty = invRow.Status === 'AVAILABLE' ? pickableQty(invRow) : 0;
            if (availableQty <= 0 || req.pickQty > availableQty) {
                throw new PickingError('INSUFFICIENT_STOCK', `Only ${availableQty} of ${detail.ItemCode} available in box ${req.boxNumber}; cannot pick ${req.pickQty}.`);
            }

            // 1-3. Detail PickedQty / RemainingQty (guarded UPDATE — cannot over-pick even under a race).
            const updatedDetail = await pickingRepository.applyPickToDetail(transaction, detail.PickListDetailID, req.pickQty);
            if (!updatedDetail) {
                throw new PickingError('PICK_QTY_EXCEEDS_REMAINING', `Pick quantity exceeds the remaining required quantity for ${detail.ItemCode}.`);
            }

            // 4. Reduce WMS inventory exactly like the existing picking flow (Quantity down, CLEARED at 0).
            const inventoryRemainingQty = subtractQty(invRow.Quantity, req.pickQty);
            await inventoryRepository.deductInventoryQty(transaction, invRow.InventoryID, { remainingQty: inventoryRemainingQty, updatedBy: createdBy });

            // Keeps the existing Picking History report complete.
            const historyRow = await pickingRepository.insertPickingHistory(transaction, {
                inventoryId: invRow.InventoryID,
                palletMappingId: mapping.PalletMappingID,
                palletId: mapping.PalletID,
                boxNumber: req.boxNumber,
                itemCode: detail.ItemCode,
                itemGroup: invRow.ItemGroup,
                warehouseCode: invRow.WarehouseCode,
                locationCode: invRow.LocationCode,
                pickedQty: req.pickQty,
                remainingQty: inventoryRemainingQty,
                pickedBy: createdBy
            });

            const box = await palletMappingRepository.findMappingBoxByBoxNumber(req.boxNumber, transaction);
            const pickTransaction = await pickingRepository.insertPickTransaction(transaction, {
                pickListId: header.PickListID,
                pickListDetailId: detail.PickListDetailID,
                sourceDocEntry: detail.SourceDocEntry,
                sourceDocNum: detail.SourceDocNum,
                sourceLineNum: detail.SourceLineNum,
                itemCode: detail.ItemCode,
                warehouse: invRow.WarehouseCode,
                locationId: invRow.LocationID,
                location: invRow.LocationCode,
                inventoryId: invRow.InventoryID,
                palletMappingId: mapping.PalletMappingID,
                palletNumber: mapping.PalletID,
                boxId: box && Number(box.PalletMappingID) === Number(mapping.PalletMappingID) ? box.PalletMappingBoxID : null,
                boxNumber: req.boxNumber,
                availableQty,
                pickQty: req.pickQty,
                pickingHistoryId: historyRow && historyRow.PickingID,
                clientRequestId: req.clientRequestId,
                createdBy
            });

            const progress = await pickingRepository.refreshPickListProgress(transaction, header.PickListID, createdBy);
            const palletPickingStatus = await refreshPalletPickingStatus(transaction, mapping.PalletMappingID);

            return {
                pickListId: header.PickListID,
                pickListDetailId: detail.PickListDetailID,
                pickTransactionId: pickTransaction.PickTransactionID,
                itemCode: detail.ItemCode,
                pickQty: req.pickQty,
                pickedQty: Number(updatedDetail.PickedQty),
                remainingQty: Number(updatedDetail.RemainingQty),
                detailStatus: updatedDetail.Status,
                pickListStatus: progress ? progress.Status : header.Status,
                source: { docEntry: detail.SourceDocEntry, docNum: detail.SourceDocNum, lineNum: detail.SourceLineNum },
                palletNumber: mapping.PalletID,
                palletPickingStatus,
                boxNumber: req.boxNumber,
                location: invRow.LocationCode,
                inventoryRemainingQty
            };
        });
        return toSavedPickDto(saved);
    } catch (error) {
        if (error && error.isDuplicateClientRequest) {
            const duplicate = await duplicatePickResult(req);
            if (duplicate) return duplicate;
        }
        throw error;
    }
}

/* ================================================================================================
 * Complete Pick List -> DC -> SAP Stock Transfer
 * ============================================================================================== */

function completionSummary(header, extra = {}) {
    return {
        pickListId: header.PickListID,
        pickListNumber: header.PickListNumber,
        status: header.Status,
        dcNumber: header.DCNumber || null,
        stockTransferDocEntry: header.StockTransferDocEntry || null,
        stockTransferNumber: header.StockTransferNumber || null,
        ...extra
    };
}

function errorMessage(error) {
    return (error && error.message) || String(error);
}

/**
 * Step 1 (one transaction): lock the Pick List, verify every line is fully picked and matches its pick
 * transactions, stamp CompletedBy/CompletedDate (first time only), move to PICKED and take the
 * processing lease. Returns { alreadyCompleted, header }.
 */
async function validateAndBeginCompletion(pickListId, completedBy, processingToken) {
    return sequelize.transaction(async (transaction) => {
        const header = await pickingRepository.lockPickListById(transaction, pickListId);
        if (!header) {
            throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${pickListId} was not found.`);
        }
        if (header.Status === 'COMPLETED') {
            return { alreadyCompleted: true, header };
        }
        if (header.Status === 'CANCELLED') {
            throw new PickingError('PICKLIST_CANCELLED', `Pick List ${header.PickListNumber} is cancelled.`);
        }
        if (header.ProcessingToken && Number(header.ProcessingAgeSeconds) < PROCESSING_LEASE_SECONDS) {
            throw new PickingError('PICKLIST_PROCESSING', `Pick List ${header.PickListNumber} is already being completed. Please wait and refresh.`);
        }

        const details = await pickingRepository.lockPickListDetails(transaction, pickListId);
        if (details.length === 0) {
            throw new PickingError('PICKING_INCOMPLETE', `Pick List ${header.PickListNumber} has no lines.`);
        }
        const pending = details.filter(d => toQty(d.RemainingQty) > 0 || toQty(d.PickedQty) !== toQty(d.RequestedQty));
        if (pending.length > 0) {
            throw new PickingError('PICKING_INCOMPLETE',
                `Pick List ${header.PickListNumber} still has ${pending.length} line(s) with remaining quantity.`,
                { pendingLines: pending.map(toPickListDetailDto) });
        }

        // Audit integrity: the picked quantity on every line must equal the sum of its pick transactions.
        const transactions = await pickingRepository.getPickTransactions(pickListId, transaction);
        const pickedByDetail = new Map();
        for (const t of transactions) {
            pickedByDetail.set(t.PickListDetailID, sumQty([pickedByDetail.get(t.PickListDetailID) || 0, t.PickQty]));
        }
        const mismatched = details.filter(d => (pickedByDetail.get(d.PickListDetailID) || 0) !== toQty(d.PickedQty));
        if (mismatched.length > 0) {
            throw new PickingError('PICK_AUDIT_MISMATCH',
                `Pick List ${header.PickListNumber}: picked quantity does not match pick transactions on ${mismatched.length} line(s).`,
                { lines: mismatched.map(d => ({ pickListDetailId: d.PickListDetailID, pickedQty: Number(d.PickedQty), transactionQty: pickedByDetail.get(d.PickListDetailID) || 0 })) });
        }

        await pickingRepository.beginCompletion(transaction, pickListId, { completedBy, processingToken });
        return { alreadyCompleted: false, header };
    });
}

/**
 * POST /picklist/:id/complete — idempotent and resumable.
 *
 * An HTTP call to SAP cannot live inside a SQL transaction, so completion is a persisted state machine
 * where each database step is its own transaction:
 *   1. validate + PICKED (+ processing lease)   2. DC (DC_CREATED)   3. SAP Stock Transfer (COMPLETED)
 * A failure at step 2 or 3 records the error, releases the lease and leaves the Pick List at the last
 * successful state; calling Complete again resumes from there. Calling it on a COMPLETED Pick List just
 * returns the stored DC / Stock Transfer references — nothing is generated twice.
 */
async function completePickListAsync(pickListIdRaw, user) {
    const pickListId = readId(pickListIdRaw);
    if (!pickListId) throw new PickingError('MISSING_FIELDS', 'A valid pickListId is required.');
    const actor = userName(user);
    const processingToken = crypto.randomUUID();

    let begun;
    try {
        begun = await validateAndBeginCompletion(pickListId, actor, processingToken);
    } catch (error) {
        if (error instanceof PickingError && error.code !== 'PICKLIST_NOT_FOUND' && error.code !== 'PICKLIST_PROCESSING') {
            await pickingRepository.insertProcessLog({ pickListId, stage: 'VALIDATION', result: 'FAILED', message: error.message, createdBy: actor });
        }
        throw error;
    }
    if (begun.alreadyCompleted) {
        return completionSummary(begun.header, { alreadyCompleted: true });
    }
    await pickingRepository.insertProcessLog({ pickListId, stage: 'VALIDATION', result: 'SUCCESS', message: 'All lines fully picked.', createdBy: actor });

    let dc;
    try {
        dc = await dcService.generateDCFromPickList(pickListId, { user: actor });
        await pickingRepository.insertProcessLog({
            pickListId, stage: 'DC', result: dc.created ? 'SUCCESS' : 'SKIPPED',
            message: dc.created ? `DC ${dc.dcNumber} generated.` : `DC ${dc.dcNumber} already existed.`, createdBy: actor
        });
    } catch (error) {
        await pickingRepository.recordPickListError(pickListId, { stage: 'DC', message: errorMessage(error), updatedBy: actor });
        await pickingRepository.insertProcessLog({ pickListId, stage: 'DC', result: 'FAILED', message: errorMessage(error), createdBy: actor });
        await pickingRepository.releaseProcessingLease(pickListId, processingToken);
        throw new PickingError('DC_GENERATION_FAILED',
            `Picking is complete but DC generation failed: ${errorMessage(error)}. Retry Complete to continue.`,
            { pickListId, stage: 'DC' });
    }

    let stockTransfer;
    try {
        stockTransfer = await sapStockTransferService.postStockTransferForPickList(pickListId, { user: actor, processingToken });
    } catch (error) {
        await pickingRepository.recordPickListError(pickListId, { stage: 'SAP', message: errorMessage(error), updatedBy: actor });
        if (!(error instanceof sapStockTransferService.SapServiceError && error.code === 'SAP_STOCK_TRANSFER_FAILED')) {
            // SAP_STOCK_TRANSFER_FAILED is already logged with its payload by the SAP service.
            await pickingRepository.insertProcessLog({ pickListId, stage: 'SAP', result: 'FAILED', message: errorMessage(error), createdBy: actor });
        }
        await pickingRepository.releaseProcessingLease(pickListId, processingToken);
        throw new PickingError('SAP_STOCK_TRANSFER_FAILED',
            `DC ${dc.dcNumber} was generated but the SAP Stock Transfer failed: ${errorMessage(error)}. Retry Complete to continue.`,
            { pickListId, stage: 'SAP', dcNumber: dc.dcNumber });
    }

    const header = await pickingRepository.findPickListById(pickListId);
    return completionSummary(header, {
        alreadyCompleted: false,
        dcNumber: dc.dcNumber,
        stockTransferDocEntry: stockTransfer.docEntry,
        stockTransferNumber: stockTransfer.docNum !== undefined && stockTransfer.docNum !== null ? String(stockTransfer.docNum) : null
    });
}

module.exports = {
    PickingError,
    PICKLIST_FROM_WAREHOUSE,
    PICKLIST_TO_WAREHOUSE,
    // legacy pallet picking
    scanPalletAsync,
    scanBoxAsync,
    completePickingAsync,
    // Pick List
    getStockTransferRequestLinesAsync,
    createPickListAsync,
    listPickListsAsync,
    getPickListAsync,
    savePickTransactionAsync,
    completePickListAsync
};
