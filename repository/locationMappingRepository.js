const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/** Non-locking lookup of the current ACTIVE location mapping for a PalletMappingID, if any. */
async function findActiveMappingByPalletMappingId(palletMappingId, transaction) {
    const rows = await sequelize.query(`
        SELECT TOP 1 LocationMappingID, LocationID, LocationCode, WarehouseCode, RowCode, PositionNo,
               PalletMappingID, PalletID, Action, Status, MappedBy, MappedAt
        FROM T_LOCATION_MAPPING WITH (NOLOCK)
        WHERE PalletMappingID = :palletMappingId AND Status = 'ACTIVE'
    `, {
        replacements: { palletMappingId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Latest mapping (ACTIVE or SUPERSEDED) for a PalletMappingID — used for support/reporting lookups. */
async function findLatestMappingByPalletMappingId(palletMappingId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 LocationMappingID, LocationID, LocationCode, WarehouseCode, RowCode, PositionNo,
               PalletMappingID, PalletID, Action, Status, MappedBy, MappedAt
        FROM T_LOCATION_MAPPING WITH (NOLOCK)
        WHERE PalletMappingID = :palletMappingId
        ORDER BY MappedAt DESC
    `, {
        replacements: { palletMappingId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function insertLocationMapping(transaction, { locationId, locationCode, warehouseCode, rowCode, positionNo, palletMappingId, palletId, mappedBy }) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_LOCATION_MAPPING
                (LocationID, LocationCode, WarehouseCode, RowCode, PositionNo, PalletMappingID, PalletID, Action, Status, MappedBy, MappedAt)
            OUTPUT INSERTED.LocationMappingID, INSERTED.MappedAt
            VALUES (:locationId, :locationCode, :warehouseCode, :rowCode, :positionNo, :palletMappingId, :palletId, 'MAPPED', 'ACTIVE', :mappedBy, GETDATE())
        `, {
            replacements: { locationId, locationCode, warehouseCode, rowCode, positionNo, palletMappingId, palletId, mappedBy },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            const conflictError = new Error('This pallet or location was just claimed by another request.');
            conflictError.code = 'LOCATION_MAPPING_CONFLICT';
            throw conflictError;
        }
        throw error;
    }
}

module.exports = {
    findActiveMappingByPalletMappingId,
    findLatestMappingByPalletMappingId,
    insertLocationMapping
};
