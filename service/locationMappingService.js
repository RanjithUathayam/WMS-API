const { sequelize } = require('../config/database');
const locationRepository = require('../repository/locationRepository');
const locationMappingRepository = require('../repository/locationMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
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

function sumBoxQty(boxes) {
    return boxes.reduce((total, box) => total + (Number(box.BoxTotalQty) || 0), 0);
}

/**
 * Backend-computed process status (Prebinning -> Pallet Mapping -> Location Mapping -> Inventory),
 * derived entirely from existing state — no extra status column is stored for this.
 */
function deriveProcessStatus(pallet, activeMapping) {
    if (pallet.Status !== 'COMPLETED') return 'PALLET_MAPPING_IN_PROGRESS';
    if (activeMapping) return 'LOCATION_MAPPED';
    return 'PALLET_MAPPED';
}

/**
 * Advisory pallet validation for the location-mapping scan step. Returns only what the frontend
 * needs to decide/display next — never the full box/item dataset.
 */
async function validatePalletForLocationMappingAsync(palletId) {
    if (isBlank(palletId)) {
        throw new LocationMappingError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const trimmedPalletId = String(palletId).trim();

    const pallet = await palletMappingRepository.findLatestPalletByPalletId(trimmedPalletId);
    if (!pallet) {
        throw new LocationMappingError('PALLET_NOT_FOUND', `Pallet ${trimmedPalletId} was not found.`);
    }

    const boxes = await palletMappingRepository.getMappedBoxesForPallet(pallet.PalletMappingID);
    const activeMapping = await locationMappingRepository.findActiveMappingByPalletMappingId(pallet.PalletMappingID);

    const eligibleForLocationMapping = pallet.Status === 'COMPLETED' && boxes.length > 0 && !activeMapping;

    return {
        palletId: trimmedPalletId,
        boxCount: boxes.length,
        totalQuantity: sumBoxQty(boxes),
        mappingStatus: pallet.Status,
        currentLocationCode: activeMapping ? activeMapping.LocationCode : null,
        currentStatus: deriveProcessStatus(pallet, activeMapping),
        eligibleForLocationMapping
    };
}

async function getMappingByPalletIdAsync(palletId) {
    if (isBlank(palletId)) {
        throw new LocationMappingError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const trimmedPalletId = String(palletId).trim();

    const pallet = await palletMappingRepository.findLatestPalletByPalletId(trimmedPalletId);
    if (!pallet) {
        throw new LocationMappingError('PALLET_NOT_FOUND', `Pallet ${trimmedPalletId} was not found.`);
    }

    const mapping = await locationMappingRepository.findLatestMappingByPalletMappingId(pallet.PalletMappingID);
    if (!mapping) {
        throw new LocationMappingError('LOCATION_MAPPING_NOT_FOUND', `Pallet ${trimmedPalletId} has not been mapped to a location yet.`);
    }

    return {
        palletId: trimmedPalletId,
        locationCode: mapping.LocationCode,
        warehouseCode: mapping.WarehouseCode,
        rowCode: mapping.RowCode,
        positionNo: mapping.PositionNo,
        action: mapping.Action,
        status: mapping.Status,
        mappedBy: mapping.MappedBy,
        mappedAt: mapping.MappedAt
    };
}

async function mapPalletToLocationAsync(rawRequest, user) {
    const warehouseCode = rawRequest && String(rawRequest.warehouseCode || '').trim();
    const rowCode = rawRequest && String(rawRequest.rowCode || '').trim();
    const locationId = rawRequest && rawRequest.locationId;
    const palletId = rawRequest && String(rawRequest.palletId || '').trim();

    if (isBlank(warehouseCode) || isBlank(rowCode) || isBlank(locationId) || isBlank(palletId)) {
        throw new LocationMappingError('MISSING_FIELDS', 'warehouseCode, rowCode, locationId and palletId are required.');
    }
    // Operator identity always comes from the authenticated session, never the request body.
    const mappedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        // 1 — Location: must exist and belong to the warehouse/row the operator actually selected.
        const location = await locationRepository.lockLocationById(transaction, locationId);
        if (!location) {
            throw new LocationMappingError('LOCATION_NOT_FOUND', `Location ${locationId} was not found.`);
        }
        if (location.WarehouseCode !== warehouseCode || location.RowCode !== rowCode) {
            throw new LocationMappingError('LOCATION_MISMATCH', 'Location does not belong to the selected warehouse/row.');
        }

        // 2 — Occupancy / idempotency gate on the Location itself.
        if (location.Status === 'OCCUPIED') {
            if (String(location.CurrentPalletID) === palletId) {
                // Safe retry of an already-successful mapping — no-op success, no duplicate writes.
                return {
                    palletId,
                    locationCode: location.LocationCode,
                    status: 'LOCATION_MAPPED',
                    idempotent: true
                };
            }
            throw new LocationMappingError('LOCATION_NOT_AVAILABLE', `Location ${location.LocationCode} is already occupied.`);
        }
        if (location.Status === 'BLOCKED') {
            throw new LocationMappingError('LOCATION_BLOCKED', `Location ${location.LocationCode} is blocked.`);
        }
        if (location.Status === 'INACTIVE') {
            throw new LocationMappingError('LOCATION_INACTIVE', `Location ${location.LocationCode} is inactive.`);
        }

        // 3 — Pallet: must exist and have completed Pallet Mapping (T_PALLET_MAPPING is the source of truth).
        const pallet = await palletMappingRepository.lockLatestPalletByPalletId(transaction, palletId);
        if (!pallet) {
            throw new LocationMappingError('PALLET_NOT_FOUND', `Pallet ${palletId} was not found.`);
        }
        if (pallet.Status !== 'COMPLETED') {
            throw new LocationMappingError('PALLET_MAPPING_NOT_COMPLETED', `Pallet ${palletId} has not completed Pallet Mapping yet.`);
        }

        // 4 — Pallet must not already be actively mapped to a different location.
        const activeMapping = await locationMappingRepository.findActiveMappingByPalletMappingId(pallet.PalletMappingID, transaction);
        if (activeMapping && activeMapping.LocationID !== Number(locationId)) {
            throw new LocationMappingError('PALLET_ALREADY_MAPPED', `Pallet ${palletId} is already mapped to location ${activeMapping.LocationCode}.`);
        }

        // 5 — Boxes: source of truth for what physically sits on this pallet.
        const boxes = await palletMappingRepository.getMappedBoxesForPallet(pallet.PalletMappingID);
        if (boxes.length === 0) {
            throw new LocationMappingError('PALLET_EMPTY', `Pallet ${palletId} has no mapped boxes.`);
        }

        // 6 — Defensive warehouse-consistency check across the pallet's own boxes and the target location.
        const boxWarehouseCodes = Array.from(new Set(boxes.map(b => b.WarehouseCode).filter(Boolean)));
        if (boxWarehouseCodes.length > 1 || (boxWarehouseCodes.length === 1 && boxWarehouseCodes[0] !== warehouseCode)) {
            throw new LocationMappingError('PALLET_WAREHOUSE_MISMATCH', `Pallet ${palletId} belongs to a different warehouse than location ${location.LocationCode}.`);
        }

        // 7 — Record the mapping event (audit trail + DB-level concurrency backstop).
        try {
            await locationMappingRepository.insertLocationMapping(transaction, {
                locationId: location.LocationID,
                locationCode: location.LocationCode,
                warehouseCode: location.WarehouseCode,
                rowCode: location.RowCode,
                positionNo: location.PositionNo,
                palletMappingId: pallet.PalletMappingID,
                palletId,
                mappedBy
            });
        } catch (error) {
            if (error.code === 'LOCATION_MAPPING_CONFLICT') {
                throw new LocationMappingError('LOCATION_MAPPING_CONFLICT', error.message);
            }
            throw error;
        }

        // 8 — Flip the Location to OCCUPIED (denormalized cache for zero-join lookups).
        await locationRepository.occupyLocation(transaction, location.LocationID, {
            palletMappingId: pallet.PalletMappingID,
            palletId,
            occupiedBy: mappedBy
        });

        // 9 — Derive Inventory from the already-existing Prebinning + Pallet Mapping data (upsert, not insert-blind).
        const boxNumbers = boxes.map(b => b.BoxNumber);
        const itemBreakdown = await inventoryRepository.getItemBreakdownForBoxes(transaction, boxNumbers);

        let totalQuantity = 0;
        for (const item of itemBreakdown) {
            totalQuantity += Number(item.qty) || 0;
            await inventoryRepository.upsertInventoryRow(transaction, {
                warehouseCode: location.WarehouseCode,
                rowCode: location.RowCode,
                locationId: location.LocationID,
                locationCode: location.LocationCode,
                palletMappingId: pallet.PalletMappingID,
                palletId,
                boxNumber: item.boxNumber,
                itemCode: item.itemCode,
                itemGroup: item.itemGroup,
                quantity: item.qty,
                userName: mappedBy
            });
        }

        return {
            palletId,
            locationCode: location.LocationCode,
            status: 'LOCATION_MAPPED',
            boxCount: boxes.length,
            totalQuantity,
            idempotent: false
        };
    });
}

module.exports = {
    LocationMappingError,
    validatePalletForLocationMappingAsync,
    getMappingByPalletIdAsync,
    mapPalletToLocationAsync
};
