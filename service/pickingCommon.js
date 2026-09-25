/**
 * Helpers shared by every picking service (legacy pallet picking, Pick List picking, inventory, DC, SAP)
 * so the same validation rules apply everywhere.
 */

class PickingError extends Error {
    /** `data` is optional structured detail returned to the client (e.g. which lines are still unpicked). */
    constructor(code, message, data = null) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

/** Pick List statuses in which picking (scan / save pick) is still allowed. */
const PICKABLE_STATUSES = ['OPEN', 'IN_PROGRESS'];

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function readString(value) {
    return value !== undefined && value !== null ? String(value).trim() : '';
}

/** PalletNumber (the value operators scan) and PalletID are the same identity in this system — Pallet Mapping/Location Mapping already key everything off PalletID. */
function readPalletNumber(rawRequest) {
    return readString(rawRequest && (rawRequest.palletNumber || rawRequest.palletId));
}

function readBoxNumber(rawRequest) {
    return readString(rawRequest && (rawRequest.boxNumber || rawRequest.boxId));
}

/** Positive integer id, or null. */
function readId(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Quantities are DECIMAL(18,3) in the database — do every comparison/arithmetic in thousandths to avoid float drift. */
function toQty(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 1000) / 1000;
}

function subtractQty(a, b) {
    return (Math.round(Number(a) * 1000) - Math.round(Number(b) * 1000)) / 1000;
}

function sumQty(values) {
    return values.reduce((acc, v) => acc + Math.round(Number(v || 0) * 1000), 0) / 1000;
}

/** Quantity that can still be picked from one T_INVENTORY row. */
function pickableQty(row) {
    const quantity = row.Quantity !== null && row.Quantity !== undefined ? Number(row.Quantity) : 0;
    const allocated = row.AllocatedQty !== null && row.AllocatedQty !== undefined ? Number(row.AllocatedQty) : 0;
    return Math.max(subtractQty(quantity, allocated), 0);
}

function sameCode(a, b) {
    return readString(a).toUpperCase() === readString(b).toUpperCase();
}

/** Confirms a pallet mapping is eligible for picking (fully box-mapped, not yet fully picked). */
function assertPalletPickable(mapping, palletNumber) {
    if (!mapping) {
        throw new PickingError('PALLET_NOT_FOUND', `Pallet ${palletNumber} was not found.`);
    }
    if (mapping.Status !== 'COMPLETED') {
        throw new PickingError('PALLET_NOT_AVAILABLE', `Pallet ${palletNumber} is not available for picking (pallet mapping is not complete yet).`);
    }
    if (mapping.PickingStatus === 'COMPLETED') {
        throw new PickingError('PALLET_NOT_AVAILABLE', `Pallet ${palletNumber} has already been fully picked.`);
    }
}

function toInventoryLineDto(row) {
    const quantity = row.Quantity !== null && row.Quantity !== undefined ? Number(row.Quantity) : 0;
    const allocatedQty = row.AllocatedQty !== null && row.AllocatedQty !== undefined ? Number(row.AllocatedQty) : 0;
    return {
        inventoryId: row.InventoryID,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        boxNumber: row.BoxNumber,
        itemCode: row.ItemCode,
        itemName: row.ItemName || null,
        itemGroup: row.ItemGroup || null,
        availableQty: quantity,
        allocatedQty,
        pickableQty: pickableQty(row),
        warehouseCode: row.WarehouseCode || null,
        rowCode: row.RowCode || null,
        locationId: row.LocationID || null,
        locationCode: row.LocationCode || null,
        pickingStatus: row.Status === 'CLEARED' ? 'PICKED' : 'PENDING'
    };
}

module.exports = {
    PickingError,
    PICKABLE_STATUSES,
    isBlank,
    readString,
    readPalletNumber,
    readBoxNumber,
    readId,
    toQty,
    subtractQty,
    sumQty,
    pickableQty,
    sameCode,
    assertPalletPickable,
    toInventoryLineDto
};
