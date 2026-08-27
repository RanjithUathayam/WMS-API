const { sequelize } = require('../config/database');
const repository = require('../repository/preBinningRepository');

class PreBinningError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const REQUIRED_SCAN_FIELDS = ['whsCode', 'boxNumber', 'itemCode', 'grnNo', 'itemGroup', 'uniqueNumber', 'qty'];

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Item QR format: ITEMCODE|TYPE|GRN NO|ITEMGROUP|UNIQUE NUMBER|QTY
 * Exposed for callers that hand the backend the raw scanned QR string instead of already-split fields.
 */
function parseItemQr(rawQr) {
    if (typeof rawQr !== 'string' || rawQr.trim() === '') {
        throw new PreBinningError('INVALID_QR', 'QR value is required.');
    }

    const parts = rawQr.split('|').map(part => part.trim());
    if (parts.length !== 6) {
        throw new PreBinningError('INVALID_QR_FORMAT', `Expected 6 fields in the item QR, received ${parts.length}.`);
    }

    const [itemCode, type, grnNo, itemGroup, uniqueNumber, qtyRaw] = parts;

    if (isBlank(itemCode)) throw new PreBinningError('INVALID_QR_FORMAT', 'ItemCode is required in the QR.');
    if (isBlank(type)) throw new PreBinningError('INVALID_QR_FORMAT', 'Type is required in the QR.');
    if (isBlank(grnNo)) throw new PreBinningError('INVALID_QR_FORMAT', 'GRNNo is required in the QR.');
    if (isBlank(itemGroup)) throw new PreBinningError('INVALID_QR_FORMAT', 'ItemGroup is required in the QR.');
    if (isBlank(uniqueNumber)) throw new PreBinningError('INVALID_QR_FORMAT', 'UniqueNumber is required in the QR.');

    const qty = Number(qtyRaw);
    if (isBlank(qtyRaw) || Number.isNaN(qty) || qty <= 0) {
        throw new PreBinningError('INVALID_QR_FORMAT', 'Qty must be greater than zero.');
    }

    return { itemCode, type, grnNo, itemGroup, uniqueNumber, qty };
}

/** Request-shape validation, applied the same way whether fields arrived pre-split or via itemQr. */
function validateScanRequest(body) {
    let source = body;

    if (!isBlank(body.itemQr)) {
        const parsed = parseItemQr(body.itemQr);
        source = {
            whsCode: body.whsCode,
            boxNumber: body.boxNumber,
            itemCode: parsed.itemCode,
            type: parsed.type,
            grnNo: parsed.grnNo,
            itemGroup: parsed.itemGroup,
            uniqueNumber: parsed.uniqueNumber,
            qty: parsed.qty
        };
    }

    if (isBlank(source.whsCode)) {
        throw new PreBinningError('WAREHOUSE_REQUIRED', 'Please select a warehouse before scanning items.');
    }

    const missing = REQUIRED_SCAN_FIELDS.filter(field => field !== 'whsCode' && isBlank(source[field]));
    if (missing.length) {
        throw new PreBinningError('MISSING_FIELDS', `Missing required field(s): ${missing.join(', ')}`);
    }

    const qty = Number(source.qty);
    if (Number.isNaN(qty) || qty <= 0) {
        throw new PreBinningError('INVALID_QTY', 'Qty must be greater than zero.');
    }

    return {
        whsCode: String(source.whsCode).trim(),
        boxNumber: String(source.boxNumber).trim(),
        itemCode: String(source.itemCode).trim(),
        type: isBlank(source.type) ? null : String(source.type).trim(),
        grnNo: String(source.grnNo).trim(),
        itemGroup: String(source.itemGroup).trim(),
        uniqueNumber: String(source.uniqueNumber).trim(),
        qty
    };
}

/** Trims and validates whsCode, returning the normalized value for the caller to use onward. */
async function assertWarehouseAllowed(transaction, whsCode) {
    if (isBlank(whsCode)) {
        throw new PreBinningError('WAREHOUSE_REQUIRED', 'Please select a warehouse before continuing.');
    }
    const trimmed = String(whsCode).trim();
    if (!(await repository.isWarehouseAllowed(transaction, trimmed))) {
        throw new PreBinningError('INVALID_WAREHOUSE', 'Selected warehouse is invalid or not available.');
    }
    return trimmed;
}

async function getPreBinningWarehousesAsync() {
    const rows = await repository.getPreBinningWarehouses();
    return rows.map(row => ({ whsCode: row.whsCode, whsName: row.whsName }));
}

async function getWarehouseStockAsync(whsCode) {
    const trimmedWhsCode = await assertWarehouseAllowed(null, whsCode);

    const rows = await repository.getWarehouseStock(trimmedWhsCode);
    return rows.map(row => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        itemGroup: row.itemGroup,
        whsCode: row.warehouseCode,
        whsName: row.warehouseName,
        availableQty: Number(row.availableQty)
    }));
}

/** Resolves the current, permanent state of a box number: AVAILABLE, IN_PROGRESS, or COMPLETED. */
function describeBoxState(box, whsCode) {
    if (!box) {
        return { exists: false, status: 'AVAILABLE', itemGroup: null, totalQty: 0, warehouseCode: null };
    }
    if (box.Status === 'COMPLETED') {
        throw new PreBinningError('BOX_ALREADY_COMPLETED', `Box ${box.BoxNumber} is already completed.`);
    }
    if (box.WarehouseCode !== whsCode) {
        throw new PreBinningError('BOX_WAREHOUSE_MISMATCH', `Box ${box.BoxNumber} is already active in warehouse ${box.WarehouseCode}.`);
    }
    return { exists: true, status: box.Status, itemGroup: box.ItemGroup, totalQty: Number(box.TotalQty), warehouseCode: box.WarehouseCode };
}

async function validateBoxAsync({ boxQr, whsCode }) {
    if (isBlank(boxQr)) {
        throw new PreBinningError('INVALID_BOX_QR', 'Box QR is required.');
    }
    const trimmedWhsCode = await assertWarehouseAllowed(null, whsCode);

    const boxNumber = String(boxQr).trim();
    const box = await repository.findLatestBoxByNumber(boxNumber);
    const state = describeBoxState(box, trimmedWhsCode);

    return {
        boxNumber,
        whsCode: trimmedWhsCode,
        itemGroup: state.itemGroup,
        status: state.status,
        totalQty: state.totalQty
    };
}

/**
 * GRNNo is parsed off the QR and stored on the row. It's not validated against ERP_Pre_Binning
 * during scanning (stock identity for Item Scan stays WhsCode + ItemCode only), but it IS part of
 * the duplicate-scan identity: UniqueNumber is only unique within a single GRN batch, so the same
 * UniqueNumber legitimately recurs for the same ItemCode under a different GRNNo (see step 4).
 */
async function scanItemAsync(rawRequest, user) {
    const request = validateScanRequest(rawRequest);
    const scannedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        // 1 — Warehouse
        await assertWarehouseAllowed(transaction, request.whsCode);

        // 2 — Box (single-use lifetime + cross-warehouse conflict, see describeBoxState)
        let box = await repository.lockLatestBoxByNumber(transaction, request.boxNumber);
        const state = describeBoxState(box, request.whsCode);
        if (!state.exists) box = null;

        // 3 — ItemCode must exist in the selected warehouse (OITW + OITM, WhsCode + ItemCode only)
        const stock = await repository.lockWarehouseItemStock(transaction, request.whsCode, request.itemCode);
        if (!stock) {
            throw new PreBinningError('ITEM_NOT_AVAILABLE', `Item ${request.itemCode} is not available in warehouse ${request.whsCode}.`);
        }

        // 4 — Unique number (scoped to ItemCode + GRNNo — the same number can recur under a different item or GRN)
        if (await repository.uniqueNumberExists(transaction, request.itemCode, request.grnNo, request.uniqueNumber)) {
            throw new PreBinningError('DUPLICATE_ITEM_UNIQUE_NUMBER', `Unique Number ${request.uniqueNumber} for item ${request.itemCode} in GRN ${request.grnNo} has already been scanned.`);
        }

        // 5 — Box item group
        if (box && box.ItemGroup && box.ItemGroup !== request.itemGroup) {
            throw new PreBinningError('BOX_ITEMGROUP_MISMATCH', `Only ${box.ItemGroup} items are allowed in this box.`);
        }

        // Extra quantity — informational only, never blocks the scan (warehouse qty is display-only).
        const warehouseAvailableQty = Number(stock.OnHand);
        const extraQty = Math.max(0, request.qty - warehouseAvailableQty);
        
        // Persist — create/update box, insert item, update box total, still inside this transaction.
        if (!box) {
            try {
                box = await repository.createBox(transaction, {
                    boxNumber: request.boxNumber,
                    warehouseCode: request.whsCode,
                    itemGroup: request.itemGroup,
                    createdBy: scannedBy
                });
            } catch (error) {
                // Two scanners racing to open the same brand-new box number.
                const rival = await repository.lockLatestBoxByNumber(transaction, request.boxNumber);
                if (!rival) throw error;
                describeBoxState(rival, request.whsCode); // throws BOX_ALREADY_COMPLETED / BOX_WAREHOUSE_MISMATCH as appropriate
                if (rival.ItemGroup && rival.ItemGroup !== request.itemGroup) {
                    throw new PreBinningError('BOX_ITEMGROUP_MISMATCH', `Only ${rival.ItemGroup} items are allowed in this box.`);
                }
                box = rival;
            }
        } else if (!box.ItemGroup) {
            await repository.setBoxItemGroup(transaction, box.PreBinBoxID, request.itemGroup);
        }

        await repository.insertScannedItem(transaction, {
            preBinBoxID: box.PreBinBoxID,
            warehouseCode: request.whsCode,
            itemCode: request.itemCode,
            type: request.type,
            grnNo: request.grnNo,
            itemGroup: request.itemGroup,
            uniqueNumber: request.uniqueNumber,
            qty: request.qty,
            scannedBy
        });

        await repository.incrementBoxTotalQty(transaction, box.PreBinBoxID, request.qty);

        return {
            whsCode: request.whsCode,
            boxNumber: request.boxNumber,
            itemCode: request.itemCode,
            type: request.type,
            grnNo: request.grnNo,
            itemGroup: request.itemGroup,
            uniqueNumber: request.uniqueNumber,
            scannedQty: request.qty,
            warehouseAvailableQty,
            extraQty,
            boxTotalQty: Number(box.TotalQty) + request.qty
        };
    });
}

async function getBoxItemsAsync(whsCode, boxNumber) {
    if (isBlank(boxNumber)) {
        throw new PreBinningError('MISSING_FIELDS', 'boxNumber is required.');
    }

    // whsCode is optional for this read-only lookup — a box number is already globally unique
    // while IN_PROGRESS. If the caller does pass one, still validate/cross-check it.
    const trimmedWhsCode = isBlank(whsCode) ? null : await assertWarehouseAllowed(null, whsCode);

    const result = await repository.getBoxWithItems(trimmedWhsCode, String(boxNumber).trim());
    if (!result) {
        throw new PreBinningError('BOX_NOT_FOUND', `Box ${boxNumber} was not found${trimmedWhsCode ? ` in warehouse ${trimmedWhsCode}` : ''}.`);
    }

    // Summary only: grouped by ItemCode + Type, no UniqueNumber/GRNNo — those stay backend-only,
    // in T_PREBIN_ITEM, for duplicate validation/audit/traceability (see repository.getBoxWithItems).
    return {
        boxNumber: result.box.BoxNumber,
        whsCode: result.box.WarehouseCode,
        itemGroup: result.box.ItemGroup,
        totalQty: Number(result.box.TotalQty),
        status: result.box.Status,
        items: result.items.map(item => ({
            itemCode: item.ItemCode,
            type: item.Type,
            qty: Number(item.Qty)
        }))
    };
}

async function completeBoxAsync({ boxNumber, whsCode }, user) {
    if (isBlank(boxNumber)) {
        throw new PreBinningError('MISSING_FIELDS', 'boxNumber is required.');
    }

    const completedBy = user && user.UserName;
    const trimmedBoxNumber = String(boxNumber).trim();

    return sequelize.transaction(async (transaction) => {
        const trimmedWhsCode = await assertWarehouseAllowed(transaction, whsCode);

        let box = await repository.lockBoxForCompletion(transaction, trimmedWhsCode, trimmedBoxNumber);
        if (!box) {
            // Distinguish "doesn't exist anywhere" from "exists, but under a different warehouse".
            const elsewhere = await repository.lockLatestBoxByNumber(transaction, trimmedBoxNumber);
            if (elsewhere && elsewhere.Status === 'IN_PROGRESS') {
                throw new PreBinningError('BOX_WAREHOUSE_MISMATCH', `Box ${trimmedBoxNumber} is already active in warehouse ${elsewhere.WarehouseCode}.`);
            }
            throw new PreBinningError('BOX_NOT_FOUND', `Box ${trimmedBoxNumber} was not found in warehouse ${trimmedWhsCode}.`);
        }
        if (box.Status === 'COMPLETED') {
            throw new PreBinningError('BOX_ALREADY_COMPLETED', `Box ${trimmedBoxNumber} is already completed.`);
        }

        const itemCount = await repository.getItemCountForBox(transaction, box.PreBinBoxID);
        if (itemCount === 0) {
            throw new PreBinningError('BOX_EMPTY', `Box ${trimmedBoxNumber} has no scanned items.`);
        }

        const groupedLines = await repository.getBoxItemsGroupedForCompletion(transaction, box.PreBinBoxID);
        const itemNames = await repository.getItemNamesByCode(transaction, [...new Set(groupedLines.map(line => line.ItemCode))]);

        // Fixed lock ordering across concurrent completions to avoid deadlocking on shared ERP_Pre_Binning rows.
        groupedLines.sort((a, b) =>
            `${a.ItemCode}|${a.ItemGroup}`.localeCompare(`${b.ItemCode}|${b.ItemGroup}`)
        );

        for (const line of groupedLines) {
            // T_PREBIN_ITEM doesn't carry GRNNo (unvalidated/unstored during scan) — resolve the
            // best-matching GRN for this ItemCode + ItemGroup here, for T_BIN_COMPLETE's NOT NULL GRNNo.
            const grnLine = await repository.findGrnForItem(transaction, line.ItemCode, line.ItemGroup);
            await repository.insertBinCompleteRow(transaction, {
                whsCode: trimmedWhsCode,
                boxNumber: trimmedBoxNumber,
                grnNo: (grnLine && grnLine.GRNNo) || '',
                grnType: line.Type || (grnLine && grnLine.Type),
                docNo: grnLine && grnLine.DocNo,
                itemCode: line.ItemCode,
                itemName: itemNames[line.ItemCode] || line.ItemCode,
                itemGroup: line.ItemGroup,
                qty: Number(line.Qty),
                createdBy: completedBy,
                scannedItemJson: JSON.stringify((line.UniqueNumbers || '').split(',').filter(Boolean))
            });
            if (grnLine) {
                await repository.syncBinningQty(transaction, grnLine.GRNNo, line.ItemCode);
            }
        }

        await repository.completeBox(transaction, box.PreBinBoxID, completedBy);

        return {
            whsCode: trimmedWhsCode,
            boxNumber: trimmedBoxNumber,
            itemGroup: box.ItemGroup,
            totalQty: Number(box.TotalQty),
            status: 'COMPLETED'
        };
    });
}

module.exports = {
    PreBinningError,
    parseItemQr,
    validateScanRequest,
    getPreBinningWarehousesAsync,
    getWarehouseStockAsync,
    validateBoxAsync,
    scanItemAsync,
    getBoxItemsAsync,
    completeBoxAsync
};
