const repository = require('../repository/inventoryRepository');
const palletMappingRepository = require('../repository/palletMappingRepository');

class InventoryError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function toInventoryDto(row) {
    return {
        inventoryId: row.InventoryID,
        warehouseCode: row.WarehouseCode,
        rowCode: row.RowCode,
        locationId: row.LocationID,
        locationCode: row.LocationCode,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        boxNumber: row.BoxNumber,
        itemCode: row.ItemCode,
        itemGroup: row.ItemGroup,
        quantity: Number(row.Quantity),
        allocatedQty: Number(row.AllocatedQty),
        availableQty: Number(row.Quantity) - Number(row.AllocatedQty),
        status: row.Status,
        createdAt: row.CreatedAt,
        updatedAt: row.UpdatedAt
    };
}

async function getSummaryAsync({ warehouseCode, rowCode }) {
    const summary = await repository.getInventorySummary({
        warehouseCode: warehouseCode ? String(warehouseCode).trim() : null,
        rowCode: rowCode ? String(rowCode).trim() : null
    });

    return {
        totalPallets: Number(summary.totalPallets) || 0,
        totalBoxes: Number(summary.totalBoxes) || 0,
        totalQuantity: Number(summary.totalQuantity) || 0,
        availableQuantity: Number(summary.availableQuantity) || 0,
        allocatedQuantity: Number(summary.allocatedQuantity) || 0,
        occupiedLocations: Number(summary.occupiedLocations) || 0,
        availableLocations: Number(summary.availableLocations) || 0
    };
}

async function getListAsync(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize, 10) || 50));

    const filters = {
        warehouseCode: query.warehouseCode,
        rowCode: query.rowCode,
        locationId: query.locationId,
        palletId: query.palletId,
        boxNumber: query.boxNumber,
        itemCode: query.itemCode,
        itemGroup: query.itemGroup,
        status: query.status
    };

    const { rows, total } = await repository.getInventoryList(filters, {
        page,
        pageSize,
        sortBy: query.sortBy,
        sortDir: query.sortDir
    });

    return {
        items: rows.map(toInventoryDto),
        page,
        pageSize,
        total
    };
}

async function getByLocationAsync(locationId) {
    if (isBlank(locationId)) {
        throw new InventoryError('INVALID_LOCATION', 'Location ID is required.');
    }
    const rows = await repository.getInventoryByLocationId(locationId);
    return rows.map(toInventoryDto);
}

async function getByPalletAsync(palletId) {
    if (isBlank(palletId)) {
        throw new InventoryError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const pallet = await palletMappingRepository.findLatestPalletByPalletId(String(palletId).trim());
    if (!pallet) {
        throw new InventoryError('PALLET_NOT_FOUND', `Pallet ${palletId} was not found.`);
    }
    const rows = await repository.getInventoryByPalletMappingId(pallet.PalletMappingID);
    return rows.map(toInventoryDto);
}

module.exports = {
    InventoryError,
    getSummaryAsync,
    getListAsync,
    getByLocationAsync,
    getByPalletAsync
};
