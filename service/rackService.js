const { sequelize } = require('../config/database');
const repository = require('../repository/rackRepository');
const { parseItemQr } = require('./preBinningService');
const { isBlank, readString, toQty, subtractQty, sumQty } = require('./pickingCommon');

/**
 * Rack Management — Rack Store (adds loose items to a rack) and Rack Picking (takes them out).
 * No master data: a Rack is simply the scanned Rack QR code inside the selected (SAP) warehouse. It comes
 * into existence with its first saved Store. Stock lives in T_RACK_INVENTORY keyed by (WarehouseCode,
 * LocationCode = rack code, ItemCode). See sql/RackManagement_NoMaster_Migration.sql.
 */

class RackError extends Error {
    constructor(code, message, data = null) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

const MODES = ['STORE', 'PICK'];
const MAX_LINES_PER_SAVE = 500;
const MAX_QTY = 999999999;
const MAX_RACK_CODE_LENGTH = 150;
const DEFAULT_HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_PAGE_SIZE = 200;

function userName(user) {
    return (user && user.UserName) || 'SYSTEM';
}

function sameCode(a, b) {
    return readString(a).toUpperCase() === readString(b).toUpperCase();
}

function readMode(value) {
    const mode = readString(value).toUpperCase();
    if (!MODES.includes(mode)) {
        throw new RackError('INVALID_MODE', 'mode must be STORE or PICK.');
    }
    return mode;
}

function readWarehouse(body) {
    const whsCode = readString(body && (body.whsCode || body.warehouseCode));
    if (isBlank(whsCode)) {
        throw new RackError('WAREHOUSE_REQUIRED', 'Please select a warehouse before scanning.');
    }
    return whsCode;
}

/** Any scanned code is a valid rack, except an item label scanned into the rack field by mistake. */
function readRackCode(body) {
    const rackCode = readString(body && (body.rackCode || body.locationCode)).toUpperCase();
    if (isBlank(rackCode)) {
        throw new RackError('MISSING_FIELDS', 'Rack QR code is required.');
    }
    if (rackCode.includes('|')) {
        throw new RackError('INVALID_RACK_QR', 'This is an item label, not a Rack QR code. Please scan the Rack QR code.');
    }
    if (rackCode.length > MAX_RACK_CODE_LENGTH) {
        throw new RackError('INVALID_RACK_QR', `Rack QR code must be at most ${MAX_RACK_CODE_LENGTH} characters.`);
    }
    return rackCode;
}

/** Selected warehouse (must be an active SAP warehouse) + scanned rack code -> the rack. */
async function resolveRack(body) {
    const whsCode = readWarehouse(body);
    const rackCode = readRackCode(body);
    const warehouse = await repository.findWarehouse(whsCode);
    if (!warehouse) {
        throw new RackError('INVALID_WAREHOUSE', `Warehouse ${whsCode} was not found or is inactive.`);
    }
    return { WarehouseCode: warehouse.whsCode, LocationCode: rackCode };
}

/** Positive quantity with at most 3 decimals (DECIMAL(18,3)). */
function readQty(value, label) {
    const qty = Number(value);
    if (isBlank(value) || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY || toQty(qty) !== qty) {
        throw new RackError('INVALID_QTY', `${label || 'Quantity'} must be a number greater than 0 with at most 3 decimals.`);
    }
    return qty;
}

function tagKey(line) {
    return `${line.itemCode}|${line.grnNo}|${line.uniqueNumber}`.toUpperCase();
}

/**
 * Item QR -> line. Pre-Binning label (ITEMCODE|TYPE|GRN NO|ITEMGROUP|UNIQUE NUMBER|QTY) is a "tagged"
 * piece with a fixed qty; a bare ItemCode (no '|') is untagged and its qty comes from the operator.
 */
function parseItemScan(rawQr) {
    const value = readString(rawQr);
    if (isBlank(value)) {
        throw new RackError('MISSING_FIELDS', 'Item QR code is required.');
    }
    if (!value.includes('|')) {
        return { itemCode: value, itemType: null, grnNo: null, itemGroup: null, uniqueNumber: null, qty: null, tagged: false };
    }
    try {
        const parsed = parseItemQr(value);
        return {
            itemCode: parsed.itemCode,
            itemType: parsed.type,
            grnNo: parsed.grnNo,
            itemGroup: parsed.itemGroup,
            uniqueNumber: parsed.uniqueNumber,
            qty: readQty(parsed.qty, 'QR quantity'),
            tagged: true
        };
    } catch (error) {
        if (error instanceof RackError) throw error;
        throw new RackError('INVALID_ITEM_QR', `Invalid item QR: ${error.message}`);
    }
}

/** Tag state rules shared by Scan Item (read-only pre-check) and Save (authoritative, under lock). */
function assertTagAllowed(mode, tag, line, rack) {
    if (!tag) return;
    const label = `${line.itemCode} / GRN ${line.grnNo} / #${line.uniqueNumber}`;
    if (mode === 'STORE' && tag.Status === 'STORED') {
        throw new RackError('TAG_ALREADY_STORED', `Item ${label} is already stored in rack ${tag.LocationCode}.`);
    }
    if (mode === 'PICK') {
        if (tag.Status === 'PICKED') {
            throw new RackError('TAG_ALREADY_PICKED', `Item ${label} has already been picked from rack ${tag.LocationCode}.`);
        }
        if (!sameCode(tag.LocationCode, rack.LocationCode) || !sameCode(tag.WarehouseCode, rack.WarehouseCode)) {
            const where = tag.WarehouseCode ? `${tag.WarehouseCode} / ${tag.LocationCode}` : tag.LocationCode;
            throw new RackError('ITEM_NOT_IN_RACK', `Item ${label} is stored in rack ${where}, not ${rack.LocationCode}.`);
        }
    }
}

async function requireItem(itemCode) {
    const item = await repository.findItem(itemCode);
    if (!item) {
        throw new RackError('ITEM_NOT_FOUND', `Item ${itemCode} was not found in the item master.`);
    }
    return item;
}

function toRackDto(rack) {
    return {
        rackCode: rack.LocationCode,
        warehouseCode: rack.WarehouseCode
    };
}

function toStockDto(row) {
    return {
        rackInventoryId: row.RackInventoryID,
        itemCode: row.ItemCode,
        itemName: row.ItemName || null,
        itemGroup: row.ItemGroup || null,
        quantity: toQty(row.Quantity),
        updatedAt: row.UpdatedAt || row.CreatedAt || null
    };
}

function toTransactionDto(h) {
    return {
        transactionId: h.RackTransactionID,
        transactionNo: h.TransactionNo,
        mode: h.TransactionType,
        rackCode: h.LocationCode,
        warehouseCode: h.WarehouseCode,
        totalLines: Number(h.TotalLines),
        totalQty: toQty(h.TotalQty),
        deviceId: h.DeviceID || null,
        createdBy: h.CreatedBy,
        createdAt: h.CreatedAt
    };
}

function toDetailDto(d) {
    return {
        lineNum: d.LineNum,
        itemCode: d.ItemCode,
        itemName: d.ItemName || null,
        itemGroup: d.ItemGroup || null,
        itemType: d.ItemType || null,
        grnNo: d.GRNNo || null,
        uniqueNumber: d.UniqueNumber || null,
        qty: toQty(d.Qty),
        qtyBefore: toQty(d.QtyBefore),
        qtyAfter: toQty(d.QtyAfter)
    };
}

/* ================================================================================================
 * Warehouses
 * ============================================================================================== */

/** Active SAP warehouses. */
async function getWarehousesAsync() {
    const rows = await repository.getRackWarehouses();
    return rows.map(r => ({ warehouseCode: r.whsCode, warehouseName: r.whsName || r.whsCode }));
}

/* ================================================================================================
 * Scan Rack / Scan Item (read-only validation for immediate operator feedback)
 * ============================================================================================== */

/** Scan Rack — accepts any rack code in the selected warehouse and returns what it currently holds (empty for a new rack). Picking needs a non-empty rack. */
async function scanRackAsync(body) {
    const mode = readMode(body && body.mode);
    const rack = await resolveRack(body);

    const stock = (await repository.getRackStock(rack.WarehouseCode, rack.LocationCode)).map(toStockDto);
    if (mode === 'PICK' && stock.length === 0) {
        throw new RackError('RACK_EMPTY', `Rack ${rack.LocationCode} has no stock to pick.`);
    }

    return {
        mode,
        rack: toRackDto(rack),
        stock,
        totalQty: sumQty(stock.map(s => s.quantity))
    };
}

/**
 * Scan Item — validates one item QR against the scanned rack. `scannedQty` is the quantity of the same
 * item already in the operator's unsaved list, so Picking can reject a scan that would exceed rack stock.
 * Nothing is written; Save re-validates everything under lock.
 */
async function scanItemAsync(body) {
    const mode = readMode(body && body.mode);
    const scan = parseItemScan(body && body.itemQr);
    const scannedQty = isBlank(body && body.scannedQty) ? 0 : Number(body.scannedQty);
    if (!Number.isFinite(scannedQty) || scannedQty < 0) {
        throw new RackError('INVALID_REQUEST', 'scannedQty must be 0 or more.');
    }

    const rack = await resolveRack(body);
    const item = await requireItem(scan.itemCode);
    const line = { ...scan, itemCode: item.ItemCode };

    const stockRow = await repository.findRackStockRow(rack.WarehouseCode, rack.LocationCode, item.ItemCode);
    const availableQty = stockRow ? toQty(stockRow.Quantity) : 0;

    if (line.tagged) {
        assertTagAllowed(mode, await repository.findTag(line), line, rack);
    }

    const qty = line.tagged ? line.qty : 1;
    if (mode === 'PICK') {
        if (availableQty <= 0) {
            throw new RackError('ITEM_NOT_IN_RACK', `Item ${item.ItemCode} is not available in rack ${rack.LocationCode}.`);
        }
        const requested = sumQty([scannedQty, qty]);
        if (requested > availableQty) {
            throw new RackError('INSUFFICIENT_STOCK', `Only ${availableQty} of ${item.ItemCode} available in rack ${rack.LocationCode}; cannot pick ${requested}.`,
                { availableQty, requestedQty: requested });
        }
    }

    return {
        mode,
        rackCode: rack.LocationCode,
        item: {
            itemCode: item.ItemCode,
            itemName: item.ItemName,
            itemGroup: line.itemGroup || item.ItemGroup,
            itemType: line.itemType,
            grnNo: line.grnNo,
            uniqueNumber: line.uniqueNumber,
            tagged: line.tagged,
            itemQr: line.tagged ? readString(body.itemQr) : null,
            qty,
            availableQty
        }
    };
}

/* ================================================================================================
 * Save (Store / Pick) — the only mutating call
 * ============================================================================================== */

/** Each line is { itemQr } (tagged label: qty taken from the QR, never from the client) or { itemCode, qty } (untagged). */
function parseSaveLines(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new RackError('MISSING_FIELDS', 'Scan at least one item before saving.');
    }
    if (rawItems.length > MAX_LINES_PER_SAVE) {
        throw new RackError('TOO_MANY_LINES', `A single save can contain at most ${MAX_LINES_PER_SAVE} lines.`);
    }

    const seenTags = new Set();
    return rawItems.map((raw, index) => {
        let line;
        if (raw && !isBlank(raw.itemQr) && String(raw.itemQr).includes('|')) {
            line = parseItemScan(raw.itemQr);
            const key = tagKey(line);
            if (seenTags.has(key)) {
                throw new RackError('DUPLICATE_SCAN', `Item ${line.itemCode} / GRN ${line.grnNo} / #${line.uniqueNumber} is scanned more than once.`);
            }
            seenTags.add(key);
        } else {
            const itemCode = readString(raw && (raw.itemCode || raw.itemQr));
            if (isBlank(itemCode)) {
                throw new RackError('MISSING_FIELDS', `Line ${index + 1}: itemCode is required.`);
            }
            line = { itemCode, itemType: null, grnNo: null, itemGroup: null, uniqueNumber: null, tagged: false,
                qty: readQty(raw.qty, `Line ${index + 1} quantity`) };
        }
        return line;
    });
}

function parseSaveRequest(body) {
    const mode = readMode(body && body.mode);
    readWarehouse(body);
    readRackCode(body);
    const clientRequestId = readString(body && body.clientRequestId) || null;
    if (clientRequestId && clientRequestId.length > 100) {
        throw new RackError('INVALID_REQUEST', 'clientRequestId must be at most 100 characters.');
    }
    const deviceId = readString(body && body.deviceId).slice(0, 100) || null;
    const lines = parseSaveLines(body && body.items);
    return { mode, clientRequestId, deviceId, lines };
}

async function duplicateSaveResult(clientRequestId) {
    const existing = await repository.findTransactionByClientRequestId(clientRequestId);
    if (!existing) return null;
    const details = await repository.getTransactionDetails(existing.RackTransactionID);
    return { ...toTransactionDto(existing), items: details.map(toDetailDto), duplicate: true };
}

/**
 * Store: adds every line's qty to T_RACK_INVENTORY. Pick: deducts it (never below 0).
 * One transaction, fixed lock order: rack (app lock) -> stock rows (by ItemCode) -> tags (by key).
 * Every quantity is re-read under lock; any failure rolls back the whole batch, so inventory and the
 * transaction record are always written together or not at all.
 */
async function saveAsync(body, user) {
    const req = parseSaveRequest(body);
    const createdBy = userName(user);
    const rack = await resolveRack(body);

    if (req.clientRequestId) {
        const duplicate = await duplicateSaveResult(req.clientRequestId);
        if (duplicate) return duplicate;
    }

    // Canonical item codes from the item master (also rejects unknown items before any lock is taken).
    const items = new Map();
    for (const line of req.lines) {
        const key = line.itemCode.toUpperCase();
        if (!items.has(key)) items.set(key, await requireItem(line.itemCode));
        const item = items.get(key);
        line.itemCode = item.ItemCode;
        line.itemGroup = line.itemGroup || item.ItemGroup || null;
    }

    const totalQty = sumQty(req.lines.map(l => l.qty));

    try {
        const saved = await sequelize.transaction(async (transaction) => {
            await repository.lockRack(transaction, rack.WarehouseCode, rack.LocationCode);

            const header = await repository.insertTransaction(transaction, {
                transactionType: req.mode,
                locationCode: rack.LocationCode,
                warehouseCode: rack.WarehouseCode,
                totalLines: req.lines.length,
                totalQty,
                clientRequestId: req.clientRequestId,
                deviceId: req.deviceId,
                createdBy
            });

            // Stock rows, one per distinct item, in a fixed (sorted) order.
            const itemCodes = [...new Set(req.lines.map(l => l.itemCode))].sort();
            const stockByItem = new Map();
            for (const itemCode of itemCodes) {
                const itemLines = req.lines.filter(l => l.itemCode === itemCode);
                const itemQty = sumQty(itemLines.map(l => l.qty));
                const row = await repository.lockRackStockRow(transaction, rack.WarehouseCode, rack.LocationCode, itemCode);
                const before = row ? toQty(row.Quantity) : 0;

                let after;
                if (req.mode === 'STORE') {
                    after = sumQty([before, itemQty]);
                } else {
                    if (!row || before <= 0) {
                        throw new RackError('ITEM_NOT_IN_RACK', `Item ${itemCode} is not available in rack ${rack.LocationCode}.`);
                    }
                    if (itemQty > before) {
                        throw new RackError('INSUFFICIENT_STOCK', `Only ${before} of ${itemCode} available in rack ${rack.LocationCode}; cannot pick ${itemQty}.`,
                            { itemCode, availableQty: before, requestedQty: itemQty });
                    }
                    after = subtractQty(before, itemQty);
                }

                let rackInventoryId;
                if (row) {
                    rackInventoryId = row.RackInventoryID;
                    await repository.setRackStockQty(transaction, rackInventoryId, {
                        quantity: after, itemGroup: req.mode === 'STORE' ? itemLines[0].itemGroup : null, updatedBy: createdBy
                    });
                } else {
                    const inserted = await repository.insertRackStockRow(transaction, {
                        locationCode: rack.LocationCode, warehouseCode: rack.WarehouseCode, itemCode, itemGroup: itemLines[0].itemGroup, quantity: after, createdBy
                    });
                    rackInventoryId = inserted.RackInventoryID;
                }
                stockByItem.set(itemCode, { rackInventoryId, running: before, after });
            }

            // Labelled pieces: validate + move state, in a fixed (sorted) order.
            const taggedLines = req.lines.filter(l => l.tagged).sort((a, b) => tagKey(a).localeCompare(tagKey(b)));
            for (const line of taggedLines) {
                const tag = await repository.lockTag(transaction, line);
                assertTagAllowed(req.mode, tag, line, rack);
                await repository.upsertTag(transaction, {
                    itemCode: line.itemCode, grnNo: line.grnNo, uniqueNumber: line.uniqueNumber,
                    status: req.mode === 'STORE' ? 'STORED' : 'PICKED',
                    warehouseCode: rack.WarehouseCode, locationCode: rack.LocationCode, qty: line.qty,
                    transactionId: header.RackTransactionID, updatedBy: createdBy
                });
            }

            // Detail lines in scan order, with the running qty before/after each one.
            const details = [];
            for (let i = 0; i < req.lines.length; i++) {
                const line = req.lines[i];
                const stock = stockByItem.get(line.itemCode);
                const qtyBefore = stock.running;
                const qtyAfter = req.mode === 'STORE' ? sumQty([qtyBefore, line.qty]) : subtractQty(qtyBefore, line.qty);
                stock.running = qtyAfter;
                const detail = {
                    rackTransactionId: header.RackTransactionID,
                    lineNum: i + 1,
                    rackInventoryId: stock.rackInventoryId,
                    itemCode: line.itemCode,
                    itemGroup: line.itemGroup,
                    itemType: line.itemType,
                    grnNo: line.grnNo,
                    uniqueNumber: line.uniqueNumber,
                    qty: line.qty,
                    qtyBefore,
                    qtyAfter
                };
                await repository.insertTransactionDetail(transaction, detail);
                details.push(detail);
            }

            return { header, details };
        });

        return {
            ...toTransactionDto(saved.header),
            items: saved.details.map(d => ({
                lineNum: d.lineNum, itemCode: d.itemCode, itemName: (items.get(d.itemCode.toUpperCase()) || {}).ItemName || null,
                itemGroup: d.itemGroup || null, itemType: d.itemType || null, grnNo: d.grnNo || null,
                uniqueNumber: d.uniqueNumber || null, qty: d.qty, qtyBefore: d.qtyBefore, qtyAfter: d.qtyAfter
            })),
            duplicate: false
        };
    } catch (error) {
        if (error && error.isDuplicateClientRequest) {
            const duplicate = await duplicateSaveResult(req.clientRequestId);
            if (duplicate) return duplicate;
        }
        throw error;
    }
}

/* ================================================================================================
 * Transaction history
 * ============================================================================================== */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value, label) {
    const text = readString(value);
    if (!text) return null;
    if (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
        throw new RackError('INVALID_REQUEST', `${label} must be a date in YYYY-MM-DD format.`);
    }
    return text;
}

async function listHistoryAsync(query = {}) {
    const mode = isBlank(query.mode) ? null : readMode(query.mode);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || DEFAULT_HISTORY_PAGE_SIZE, 1), MAX_HISTORY_PAGE_SIZE);

    const { rows, total } = await repository.listTransactions({
        transactionType: mode,
        warehouseCode: readString(query.whsCode || query.warehouseCode) || null,
        rackCode: readString(query.rackCode).toUpperCase() || null,
        itemCode: readString(query.itemCode) || null,
        createdBy: readString(query.createdBy) || null,
        fromDate: readDate(query.fromDate, 'fromDate'),
        toDate: readDate(query.toDate, 'toDate'),
        offset: (page - 1) * pageSize,
        limit: pageSize
    });
    return { page, pageSize, total, rows: rows.map(toTransactionDto) };
}

async function getHistoryAsync(transactionIdRaw) {
    const transactionId = Number(transactionIdRaw);
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
        throw new RackError('INVALID_REQUEST', 'Transaction id must be a positive integer.');
    }
    const header = await repository.findTransactionById(transactionId);
    if (!header) {
        throw new RackError('TRANSACTION_NOT_FOUND', `Rack transaction ${transactionId} was not found.`);
    }
    const details = await repository.getTransactionDetails(transactionId);
    return { ...toTransactionDto(header), items: details.map(toDetailDto) };
}

module.exports = {
    RackError,
    parseItemScan,
    getWarehousesAsync,
    scanRackAsync,
    scanItemAsync,
    saveAsync,
    listHistoryAsync,
    getHistoryAsync
};
