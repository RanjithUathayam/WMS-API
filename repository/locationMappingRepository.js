const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/** SQL Server's duplicate-key error message names the violated index — used to tell the two DB-level concurrency backstops apart (UX_LOCMAP_ACTIVE_LOCATION vs UX_LOCMAP_ACTIVE_PALLET). */
function violatedIndexName(error) {
    const original = error && error.original;
    const message = (original && original.message) || '';
    const match = message.match(/unique index '([^']+)'/i);
    return match ? match[1] : null;
}

/** Inserts an ACTIVE location<->pallet mapping row (audit trail per T_LOCATION_MAPPING). Fails with a mapped error code if either side already has an ACTIVE mapping. */
async function insertLocationMapping(transaction, { locationId, locationCode, warehouseCode, rowCode, positionNo, palletMappingId, palletId, mappedBy }) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_LOCATION_MAPPING
                (LocationID, LocationCode, WarehouseCode, RowCode, PositionNo, PalletMappingID, PalletID, Action, Status, MappedBy, MappedAt)
            OUTPUT INSERTED.LocationMappingID, INSERTED.LocationID, INSERTED.LocationCode, INSERTED.WarehouseCode,
                   INSERTED.RowCode, INSERTED.PositionNo, INSERTED.PalletMappingID, INSERTED.PalletID,
                   INSERTED.Action, INSERTED.Status, INSERTED.MappedBy, INSERTED.MappedAt
            VALUES (:locationId, :locationCode, :warehouseCode, :rowCode, :positionNo, :palletMappingId, :palletId, 'MAPPED', 'ACTIVE', :mappedBy, GETDATE())
        `, {
            replacements: { locationId, locationCode, warehouseCode, rowCode, positionNo, palletMappingId, palletId, mappedBy },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            if (violatedIndexName(error) === 'UX_LOCMAP_ACTIVE_LOCATION') {
                const duplicateError = new Error(`Location ${locationCode} was just occupied by another request.`);
                duplicateError.code = 'LOCATION_ALREADY_OCCUPIED';
                throw duplicateError;
            }
            const duplicateError = new Error(`Pallet ${palletId} is already mapped to a location.`);
            duplicateError.code = 'PALLET_ALREADY_MAPPED';
            throw duplicateError;
        }
        throw error;
    }
}

module.exports = {
    insertLocationMapping
};
