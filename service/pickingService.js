const { sequelize } = require('../config/database');
const palletMappingRepository = require('../repository/palletMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const pickingRepository = require('../repository/pickingRepository');

class PickingError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

/** PalletNumber (the value operators scan) and PalletID are the same identity in this system — Pallet Mapping/Location Mapping already key everything off PalletID. */
function readPalletNumber(rawRequest) {
    const value = rawRequest && (rawRequest.palletNumber || rawRequest.palletId);
    return value !== undefined && value !== null ? String(value).trim() : '';
}

function readBoxNumber(rawRequest) {
    const value = rawRequest && (rawRequest.boxNumber || rawRequest.boxId);
    return value !== undefined && value !== null ? String(value).trim() : '';
}

/** Loads the pallet mapping and confirms it is eligible for picking (fully box-mapped, not yet fully picked). Shared by all three APIs so the same rules apply whether reading or locking the row. */
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
        pickableQty: Math.max(quantity - allocatedQty, 0),
        warehouseCode: row.WarehouseCode || null,
        rowCode: row.RowCode || null,
        locationId: row.LocationID || null,
        locationCode: row.LocationCode || null,
        pickingStatus: row.Status === 'CLEARED' ? 'PICKED' : 'PENDING'
    };
}

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

/**
 * Complete Picking — the only mutating step. Locks the pallet mapping row then the single
 * (pallet, box, item) inventory row (fixed lock order, mirrors palletMappingService/locationMappingService),
 * validates quantity, deducts stock, writes one T_PICKING_HISTORY row, and rolls the pallet's
 * PickingStatus forward. Everything happens in one sequelize.transaction — any thrown PickingError
 * rolls the whole thing back, so inventory is never reduced on a failed/rejected pick.
 */
async function completePickingAsync(rawRequest, user) {
    const palletNumber = readPalletNumber(rawRequest);
    const boxNumber = readBoxNumber(rawRequest);
    const itemCode = rawRequest && rawRequest.itemCode !== undefined && rawRequest.itemCode !== null
        ? String(rawRequest.itemCode).trim() : '';
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
            const boxLines = await inventoryRepository.getInventoryByPalletAndBox(mapping.PalletMappingID, boxNumber);
            if (boxLines.length === 0) {
                const existsElsewhere = await inventoryRepository.boxExistsInInventory(boxNumber);
                if (existsElsewhere) {
                    throw new PickingError('BOX_NOT_IN_PALLET', `Box ${boxNumber} does not belong to pallet ${palletNumber}.`);
                }
                throw new PickingError('BOX_NOT_FOUND', `Box ${boxNumber} was not found.`);
            }
            throw new PickingError('ITEM_NOT_FOUND', `Item ${itemCode} was not found on box ${boxNumber}.`);
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

        const remainingAvailableCount = await inventoryRepository.countAvailableInventoryForPallet(transaction, mapping.PalletMappingID);
        const newPickingStatus = remainingAvailableCount === 0 ? 'COMPLETED' : 'IN_PROGRESS';
        await pickingRepository.updatePalletPickingStatus(transaction, mapping.PalletMappingID, newPickingStatus);

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

module.exports = {
    PickingError,
    scanPalletAsync,
    scanBoxAsync,
    completePickingAsync
};
