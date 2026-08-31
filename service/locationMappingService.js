const { sequelize } = require('../config/database');
const repository = require('../repository/locationMappingRepository');
const locationRepository = require('../repository/locationRepository');
const palletMappingRepository = require('../repository/palletMappingRepository');

class LocationMappingError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function toLocationMappingDto(mapping) {
    return {
        locationMappingId: mapping.LocationMappingID,
        locationId: mapping.LocationID,
        locationCode: mapping.LocationCode,
        warehouseCode: mapping.WarehouseCode,
        rowCode: mapping.RowCode,
        positionNo: mapping.PositionNo,
        palletMappingId: mapping.PalletMappingID,
        palletId: mapping.PalletID,
        action: mapping.Action,
        status: mapping.Status,
        mappedBy: mapping.MappedBy,
        mappedAt: mapping.MappedAt
    };
}

/** Assigns an already-COMPLETED pallet mapping to an AVAILABLE location. Locks both rows inside one transaction so concurrent scans of the same pallet or location serialize instead of racing. */
async function mapPalletToLocationAsync(rawRequest, user) {
    const palletId = rawRequest && String(rawRequest.palletId || '').trim();
    const locationCode = rawRequest && String(rawRequest.locationCode || '').trim();
    const whsCode = rawRequest && rawRequest.whsCode !== undefined && rawRequest.whsCode !== null ? String(rawRequest.whsCode).trim() : null;
    const rowCode = rawRequest && rawRequest.rowCode !== undefined && rawRequest.rowCode !== null ? String(rawRequest.rowCode).trim() : null;

    if (isBlank(palletId) || isBlank(locationCode)) {
        throw new LocationMappingError('MISSING_FIELDS', 'palletId and locationCode are required.');
    }
    const mappedBy = user && user.UserName;

    const mapping = await sequelize.transaction(async (transaction) => {
        const location = await locationRepository.lockLocationByCode(transaction, locationCode);
        if (!location) {
            throw new LocationMappingError('LOCATION_NOT_FOUND', `Location ${locationCode} was not found.`);
        }
        if (!isBlank(whsCode) && location.WarehouseCode !== whsCode) {
            throw new LocationMappingError('LOCATION_MISMATCH', `Location ${locationCode} does not belong to warehouse ${whsCode}.`);
        }
        if (!isBlank(rowCode) && location.RowCode !== rowCode) {
            throw new LocationMappingError('LOCATION_MISMATCH', `Location ${locationCode} does not belong to row ${rowCode}.`);
        }
        if (location.Status !== 'AVAILABLE') {
            throw new LocationMappingError('LOCATION_NOT_AVAILABLE', `Location ${locationCode} is ${location.Status} and cannot be mapped.`);
        }

        const palletMapping = await palletMappingRepository.lockLatestMappingByPalletId(transaction, palletId);
        if (!palletMapping) {
            throw new LocationMappingError('PALLET_NOT_FOUND', `Pallet ${palletId} was not found.`);
        }
        if (palletMapping.Status !== 'COMPLETED') {
            throw new LocationMappingError('PALLET_NOT_COMPLETED', `Pallet ${palletId} must be completed (all boxes mapped) before it can be assigned to a location.`);
        }

        let insertedMapping;
        try {
            insertedMapping = await repository.insertLocationMapping(transaction, {
                locationId: location.LocationID,
                locationCode: location.LocationCode,
                warehouseCode: location.WarehouseCode,
                rowCode: location.RowCode,
                positionNo: location.PositionNo,
                palletMappingId: palletMapping.PalletMappingID,
                palletId,
                mappedBy
            });
        } catch (error) {
            if (error.code === 'PALLET_ALREADY_MAPPED' || error.code === 'LOCATION_ALREADY_OCCUPIED') {
                throw new LocationMappingError(error.code, error.message);
            }
            throw error;
        }

        await locationRepository.occupyLocation(transaction, location.LocationID, {
            palletMappingId: palletMapping.PalletMappingID,
            palletId,
            occupiedBy: mappedBy
        });

        return insertedMapping;
    });

    return toLocationMappingDto(mapping);
}

module.exports = {
    LocationMappingError,
    mapPalletToLocationAsync
};
