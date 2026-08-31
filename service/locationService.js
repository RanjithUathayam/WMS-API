const { sequelize } = require('../config/database');
const repository = require('../repository/locationRepository');

class LocationError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function parsePositionNo(positionNo) {
    const value = Number(positionNo);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
}

function buildLocationCode(warehouseCode, rowCode, positionNo) {
    return `${warehouseCode}-${rowCode}-${String(positionNo).padStart(3, '0')}`;
}

function toLocationDto(location) {
    return {
        locationId: location.LocationID,
        warehouseCode: location.WarehouseCode,
        rowCode: location.RowCode,
        positionNo: location.PositionNo,
        locationCode: location.LocationCode,
        status: location.Status,
        currentPalletId: location.CurrentPalletID || null,
        occupiedBy: location.OccupiedBy || null,
        occupiedAt: location.OccupiedAt || null,
        createdBy: location.CreatedBy,
        createdAt: location.CreatedAt,
        updatedBy: location.UpdatedBy || null,
        updatedAt: location.UpdatedAt || null
    };
}

async function getWarehousesAsync() {
    const warehouses = await repository.getWarehouses();
    return warehouses.map(w => ({ warehouseCode: w.whsCode, warehouseName: w.whsName }));
}

async function getWarehouseStatusAsync(warehouseCode) {
    if (isBlank(warehouseCode)) {
        throw new LocationError('INVALID_WAREHOUSE', 'Warehouse Code is required.');
    }
    const summary = await repository.getWarehouseSummary(String(warehouseCode).trim());
    if (!summary) {
        throw new LocationError('INVALID_WAREHOUSE', `Warehouse ${warehouseCode} was not found.`);
    }
    return {
        warehouseCode: summary.warehouseCode,
        warehouseName: summary.warehouseName,
        totalLocations: Number(summary.locations.totalLocations) || 0,
        availableLocations: Number(summary.locations.availableLocations) || 0,
        occupiedLocations: Number(summary.locations.occupiedLocations) || 0,
        blockedLocations: Number(summary.locations.blockedLocations) || 0,
        inactiveLocations: Number(summary.locations.inactiveLocations) || 0,
        totalRows: Number(summary.rows.totalRows) || 0,
        activeRows: Number(summary.rows.activeRows) || 0,
        inactiveRows: Number(summary.rows.inactiveRows) || 0
    };
}

async function getRowsAsync(warehouseCode, includeInactive) {
    if (isBlank(warehouseCode)) {
        throw new LocationError('INVALID_WAREHOUSE', 'Warehouse Code is required.');
    }
    const rows = await repository.getActiveRows(String(warehouseCode).trim(), !!includeInactive);
    return rows.map(rowCode => ({ rowCode }));
}

const MAX_POSITIONS_PER_GENERATE_CALL = 500;

async function generatePositionsAsync(rawRequest, user) {
    const warehouseCode = rawRequest && String(rawRequest.warehouseCode || '').trim();
    const rowCode = rawRequest && String(rawRequest.rowCode || '').trim();
    const startPosition = parsePositionNo(rawRequest && rawRequest.startPosition);
    const endPosition = parsePositionNo(rawRequest && rawRequest.endPosition);

    if (isBlank(warehouseCode) || isBlank(rowCode) || startPosition === null || endPosition === null) {
        throw new LocationError('MISSING_FIELDS', 'warehouseCode, rowCode, startPosition and endPosition (positive integers) are required.');
    }
    if (startPosition > endPosition) {
        throw new LocationError('INVALID_POSITION_RANGE', 'startPosition must be less than or equal to endPosition.');
    }

    const requestedCount = endPosition - startPosition + 1;
    if (requestedCount > MAX_POSITIONS_PER_GENERATE_CALL) {
        throw new LocationError('POSITION_RANGE_TOO_LARGE', `A single request can generate at most ${MAX_POSITIONS_PER_GENERATE_CALL} positions (requested ${requestedCount}).`);
    }

    const isValidWarehouse = await repository.isWarehouseValid(warehouseCode);
    if (!isValidWarehouse) {
        throw new LocationError('INVALID_WAREHOUSE', `Warehouse ${warehouseCode} was not found.`);
    }

    const createdBy = user && user.UserName;
    let createdCount;
    try {
        createdCount = await repository.generatePositions(warehouseCode, rowCode, startPosition, endPosition, createdBy);
    } catch (error) {
        if (error.code === 'LOCATION_ALREADY_EXISTS') {
            throw new LocationError('LOCATION_ALREADY_EXISTS', error.message);
        }
        throw error;
    }

    return {
        warehouseCode,
        rowCode,
        requestedCount,
        createdCount,
        duplicateCount: requestedCount - createdCount,
        skippedCount: 0
    };
}

async function getAvailablePositionsAsync(warehouseCode, rowCode) {
    if (isBlank(warehouseCode) || isBlank(rowCode)) {
        throw new LocationError('MISSING_FIELDS', 'Warehouse Code and Row Code are required.');
    }
    const positions = await repository.getAvailablePositions(String(warehouseCode).trim(), String(rowCode).trim());
    return positions.map(p => ({
        locationId: p.LocationID,
        warehouseCode: p.WarehouseCode,
        rowCode: p.RowCode,
        locationCode: p.LocationCode,
        positionNo: p.PositionNo,
        status: p.Status
    }));
}

async function createLocationAsync(rawRequest, user) {
    const warehouseCode = rawRequest && String(rawRequest.warehouseCode || '').trim();
    const rowCode = rawRequest && String(rawRequest.rowCode || '').trim();
    const positionNo = parsePositionNo(rawRequest && rawRequest.positionNo);

    if (isBlank(warehouseCode) || isBlank(rowCode) || positionNo === null) {
        throw new LocationError('MISSING_FIELDS', 'warehouseCode, rowCode and a positive integer positionNo are required.');
    }

    const isValidWarehouse = await repository.isWarehouseValid(warehouseCode);
    if (!isValidWarehouse) {
        throw new LocationError('INVALID_WAREHOUSE', `Warehouse ${warehouseCode} was not found.`);
    }

    const existing = await repository.findLocationByCombo(warehouseCode, rowCode, positionNo);
    if (existing) {
        throw new LocationError('LOCATION_ALREADY_EXISTS', `Location ${warehouseCode}/${rowCode}/${positionNo} already exists.`);
    }

    const locationCode = buildLocationCode(warehouseCode, rowCode, positionNo);
    const createdBy = user && user.UserName;

    try {
        const location = await repository.createLocation(null, { warehouseCode, rowCode, positionNo, locationCode, createdBy });
        return toLocationDto(location);
    } catch (error) {
        if (error.code === 'LOCATION_ALREADY_EXISTS') {
            throw new LocationError('LOCATION_ALREADY_EXISTS', error.message);
        }
        throw error;
    }
}

async function updateLocationAsync(locationId, rawRequest, user) {
    if (isBlank(locationId)) {
        throw new LocationError('INVALID_LOCATION', 'Location ID is required.');
    }
    const rowCode = rawRequest && rawRequest.rowCode !== undefined ? String(rawRequest.rowCode).trim() : null;
    const positionNo = rawRequest && rawRequest.positionNo !== undefined ? parsePositionNo(rawRequest.positionNo) : null;

    if (isBlank(rowCode) || positionNo === null) {
        throw new LocationError('MISSING_FIELDS', 'rowCode and a positive integer positionNo are required.');
    }
    const updatedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        const location = await repository.lockLocationById(transaction, locationId);
        if (!location) {
            throw new LocationError('LOCATION_NOT_FOUND', `Location ${locationId} was not found.`);
        }
        if (location.Status !== 'AVAILABLE') {
            throw new LocationError('LOCATION_NOT_EDITABLE', `Location ${location.LocationCode} cannot be edited while its status is ${location.Status}.`);
        }
        const historyCount = await repository.getLocationMappingHistoryCount(transaction, locationId);
        if (historyCount > 0) {
            throw new LocationError('LOCATION_HAS_HISTORY', `Location ${location.LocationCode} has mapping history and can no longer be edited.`);
        }

        const existing = await repository.findLocationByCombo(location.WarehouseCode, rowCode, positionNo);
        if (existing && existing.LocationID !== location.LocationID) {
            throw new LocationError('LOCATION_ALREADY_EXISTS', `Location ${location.WarehouseCode}/${rowCode}/${positionNo} already exists.`);
        }

        const locationCode = buildLocationCode(location.WarehouseCode, rowCode, positionNo);
        try {
            await repository.updateLocationCombo(transaction, locationId, { rowCode, positionNo, locationCode, updatedBy });
        } catch (error) {
            if (error.code === 'LOCATION_ALREADY_EXISTS') {
                throw new LocationError('LOCATION_ALREADY_EXISTS', error.message);
            }
            throw error;
        }

        return toLocationDto({ ...location, RowCode: rowCode, PositionNo: positionNo, LocationCode: locationCode, UpdatedBy: updatedBy, UpdatedAt: new Date() });
    });
}

async function setLocationActiveAsync(locationId, isActivating, user) {
    if (isBlank(locationId)) {
        throw new LocationError('INVALID_LOCATION', 'Location ID is required.');
    }
    const updatedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        const location = await repository.lockLocationById(transaction, locationId);
        if (!location) {
            throw new LocationError('LOCATION_NOT_FOUND', `Location ${locationId} was not found.`);
        }

        if (isActivating) {
            if (location.Status !== 'INACTIVE') {
                throw new LocationError('LOCATION_ALREADY_ACTIVE', `Location ${location.LocationCode} is already ${location.Status}.`);
            }
            await repository.setLocationStatus(transaction, locationId, 'AVAILABLE', updatedBy);
            return toLocationDto({ ...location, Status: 'AVAILABLE', UpdatedBy: updatedBy, UpdatedAt: new Date() });
        }

        if (location.Status === 'INACTIVE') {
            throw new LocationError('LOCATION_ALREADY_INACTIVE', `Location ${location.LocationCode} is already inactive.`);
        }
        if (location.Status === 'OCCUPIED') {
            throw new LocationError('LOCATION_OCCUPIED', `Location ${location.LocationCode} is occupied and cannot be deactivated.`);
        }
        await repository.setLocationStatus(transaction, locationId, 'INACTIVE', updatedBy);
        return toLocationDto({ ...location, Status: 'INACTIVE', UpdatedBy: updatedBy, UpdatedAt: new Date() });
    });
}

async function getLocationAsync(locationId) {
    if (isBlank(locationId)) {
        throw new LocationError('INVALID_LOCATION', 'Location ID is required.');
    }
    const location = await repository.findLocationById(locationId);
    if (!location) {
        throw new LocationError('LOCATION_NOT_FOUND', `Location ${locationId} was not found.`);
    }
    return toLocationDto(location);
}

module.exports = {
    LocationError,
    getWarehousesAsync,
    getWarehouseStatusAsync,
    getRowsAsync,
    getAvailablePositionsAsync,
    generatePositionsAsync,
    createLocationAsync,
    updateLocationAsync,
    setLocationActiveAsync,
    getLocationAsync
};
