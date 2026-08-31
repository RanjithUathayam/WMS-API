const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/**
 * Warehouses eligible for Location Master: SAP Business One (OWHS, cross-database via [BBLive])
 * warehouses at the THINDAL site — same source/site filter as preBinningRepository.getPreBinningWarehouses,
 * without the stock/item-group filtering (Location Master is not stock-dependent).
 */
async function getWarehouses() {
    return sequelize.query(`
        SELECT DISTINCT
            t0.WhsCode AS whsCode,
            t0.WhsName AS whsName
        FROM [BBLive].[dbo].OWHS t0
        WHERE t0.WhsName LIKE '%THINDAL%'
        ORDER BY t0.WhsName
    `, {
        type: QueryTypes.SELECT
    });
}

/** True only if whsCode is one of the warehouses getWarehouses would return. */
async function isWarehouseValid(warehouseCode) {
    const rows = await sequelize.query(`
        SELECT TOP 1 1 AS found
        FROM [BBLive].[dbo].OWHS t0
        WHERE t0.WhsCode = :warehouseCode AND t0.WhsName LIKE '%THINDAL%'
    `, {
        replacements: { warehouseCode },
        type: QueryTypes.SELECT
    });
    return rows.length > 0;
}

/** Warehouse identity + location/row counts for the Location Master warehouse status view. Returns null if warehouseCode is not a valid THINDAL warehouse. */
async function getWarehouseSummary(warehouseCode) {
    const whsRows = await sequelize.query(`
        SELECT TOP 1 t0.WhsCode AS whsCode, t0.WhsName AS whsName
        FROM [BBLive].[dbo].OWHS t0
        WHERE t0.WhsCode = :warehouseCode AND t0.WhsName LIKE '%THINDAL%'
    `, {
        replacements: { warehouseCode },
        type: QueryTypes.SELECT
    });
    if (whsRows.length === 0) return null;

    const [locationCounts, rowCounts] = await Promise.all([
        sequelize.query(`
            SELECT
                COUNT(*) AS totalLocations,
                SUM(CASE WHEN Status = 'AVAILABLE' THEN 1 ELSE 0 END) AS availableLocations,
                SUM(CASE WHEN Status = 'OCCUPIED' THEN 1 ELSE 0 END) AS occupiedLocations,
                SUM(CASE WHEN Status = 'BLOCKED' THEN 1 ELSE 0 END) AS blockedLocations,
                SUM(CASE WHEN Status = 'INACTIVE' THEN 1 ELSE 0 END) AS inactiveLocations
            FROM T_LOCATION WITH (NOLOCK)
            WHERE WarehouseCode = :warehouseCode
        `, { replacements: { warehouseCode }, type: QueryTypes.SELECT }),
        sequelize.query(`
            SELECT
                COUNT(*) AS totalRows,
                SUM(CASE WHEN Status = 'ACTIVE' THEN 1 ELSE 0 END) AS activeRows,
                SUM(CASE WHEN Status = 'INACTIVE' THEN 1 ELSE 0 END) AS inactiveRows
            FROM T_LOCATION_ROW WITH (NOLOCK)
            WHERE WarehouseCode = :warehouseCode
        `, { replacements: { warehouseCode }, type: QueryTypes.SELECT })
    ]);

    return {
        warehouseCode: whsRows[0].whsCode,
        warehouseName: whsRows[0].whsName,
        locations: locationCounts[0],
        rows: rowCounts[0]
    };
}

/** Distinct rows belonging to a warehouse. Excludes rows with only INACTIVE locations unless includeInactive is set. */
async function getActiveRows(warehouseCode, includeInactive) {
    const rows = await sequelize.query(`
        SELECT DISTINCT RowCode
        FROM T_LOCATION WITH (NOLOCK)
        WHERE WarehouseCode = :warehouseCode ${includeInactive ? '' : "AND Status <> 'INACTIVE'"}
        ORDER BY RowCode
    `, {
        replacements: { warehouseCode },
        type: QueryTypes.SELECT
    });
    return rows.map(r => r.RowCode);
}

/**
 * Bulk-creates AVAILABLE positions [startPosition..endPosition] for a warehouse/row in one
 * set-based statement (recursive CTE bounded by the caller's MAX_POSITIONS_PER_GENERATE_CALL,
 * so MAXRECURSION 500 is always sufficient). Existing (WarehouseCode, RowCode, PositionNo)
 * combinations are skipped via NOT EXISTS — safe to re-run over an overlapping range. Uses the
 * same LocationCode format as buildLocationCode() in locationService.js.
 */
async function generatePositions(warehouseCode, rowCode, startPosition, endPosition, createdBy) {
    try {
        const rows = await sequelize.query(`
            WITH Numbers AS (
                SELECT :startPosition AS PositionNo
                UNION ALL
                SELECT PositionNo + 1 FROM Numbers WHERE PositionNo < :endPosition
            )
            INSERT INTO T_LOCATION (WarehouseCode, RowCode, PositionNo, LocationCode, Status, CreatedBy, CreatedAt)
            OUTPUT INSERTED.PositionNo
            SELECT :warehouseCode, :rowCode, n.PositionNo,
                   :warehouseCode + '-' + :rowCode + '-' + RIGHT('000' + CAST(n.PositionNo AS VARCHAR(10)), 3),
                   'AVAILABLE', :createdBy, GETDATE()
            FROM Numbers n
            WHERE NOT EXISTS (
                SELECT 1 FROM T_LOCATION t
                WHERE t.WarehouseCode = :warehouseCode AND t.RowCode = :rowCode AND t.PositionNo = n.PositionNo
            )
            OPTION (MAXRECURSION 500);
        `, {
            replacements: { warehouseCode, rowCode, startPosition, endPosition, createdBy },
            type: QueryTypes.SELECT
        });
        return rows.length;
    } catch (error) {
        if (isUniqueViolation(error)) {
            const conflictError = new Error(`Positions for ${warehouseCode}/${rowCode} were just created by another request. Retry to fill in the remainder.`);
            conflictError.code = 'LOCATION_ALREADY_EXISTS';
            throw conflictError;
        }
        throw error;
    }
}

/** Available (unoccupied, unblocked, active) positions for a warehouse + row. */
async function getAvailablePositions(warehouseCode, rowCode) {
    return sequelize.query(`
        SELECT LocationID, WarehouseCode, RowCode, LocationCode, PositionNo, Status
        FROM T_LOCATION WITH (NOLOCK)
        WHERE WarehouseCode = :warehouseCode AND RowCode = :rowCode AND Status = 'AVAILABLE'
        ORDER BY PositionNo
    `, {
        replacements: { warehouseCode, rowCode },
        type: QueryTypes.SELECT
    });
}

async function findLocationByCombo(warehouseCode, rowCode, positionNo) {
    const rows = await sequelize.query(`
        SELECT TOP 1 LocationID, WarehouseCode, RowCode, PositionNo, LocationCode, Status
        FROM T_LOCATION WITH (NOLOCK)
        WHERE WarehouseCode = :warehouseCode AND RowCode = :rowCode AND PositionNo = :positionNo
    `, {
        replacements: { warehouseCode, rowCode, positionNo },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function findLocationById(locationId) {
    const rows = await sequelize.query(`
        SELECT LocationID, WarehouseCode, RowCode, PositionNo, LocationCode, Status,
               CurrentPalletMappingID, CurrentPalletID, OccupiedBy, OccupiedAt,
               CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
        FROM T_LOCATION WITH (NOLOCK)
        WHERE LocationID = :locationId
    `, {
        replacements: { locationId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks the location row for mutation (update/activate/deactivate/mapping) inside a transaction. */
async function lockLocationById(transaction, locationId) {
    const rows = await sequelize.query(`
        SELECT LocationID, WarehouseCode, RowCode, PositionNo, LocationCode, Status,
               CurrentPalletMappingID, CurrentPalletID, OccupiedBy, OccupiedAt
        FROM T_LOCATION WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE LocationID = :locationId
    `, {
        replacements: { locationId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function createLocation(transaction, { warehouseCode, rowCode, positionNo, locationCode, createdBy }) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_LOCATION (WarehouseCode, RowCode, PositionNo, LocationCode, Status, CreatedBy, CreatedAt)
            OUTPUT INSERTED.LocationID, INSERTED.WarehouseCode, INSERTED.RowCode, INSERTED.PositionNo,
                   INSERTED.LocationCode, INSERTED.Status, INSERTED.CreatedBy, INSERTED.CreatedAt
            VALUES (:warehouseCode, :rowCode, :positionNo, :locationCode, 'AVAILABLE', :createdBy, GETDATE())
        `, {
            replacements: { warehouseCode, rowCode, positionNo, locationCode, createdBy },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`Location ${warehouseCode}/${rowCode}/${positionNo} already exists.`);
            duplicateError.code = 'LOCATION_ALREADY_EXISTS';
            throw duplicateError;
        }
        throw error;
    }
}

async function getLocationMappingHistoryCount(transaction, locationId) {
    const rows = await sequelize.query(`
        SELECT COUNT(1) AS cnt FROM T_LOCATION_MAPPING WITH (NOLOCK) WHERE LocationID = :locationId
    `, {
        replacements: { locationId },
        transaction,
        type: QueryTypes.SELECT
    });
    return Number(rows[0].cnt);
}

async function updateLocationCombo(transaction, locationId, { rowCode, positionNo, locationCode, updatedBy }) {
    try {
        await sequelize.query(`
            UPDATE T_LOCATION
            SET RowCode = :rowCode, PositionNo = :positionNo, LocationCode = :locationCode,
                UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
            WHERE LocationID = :locationId
        `, {
            replacements: { locationId, rowCode, positionNo, locationCode, updatedBy },
            transaction,
            type: QueryTypes.UPDATE
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`Location ${rowCode}/${positionNo} already exists.`);
            duplicateError.code = 'LOCATION_ALREADY_EXISTS';
            throw duplicateError;
        }
        throw error;
    }
}

async function setLocationStatus(transaction, locationId, status, updatedBy) {
    await sequelize.query(`
        UPDATE T_LOCATION
        SET Status = :status, UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
        WHERE LocationID = :locationId
    `, {
        replacements: { locationId, status, updatedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

async function occupyLocation(transaction, locationId, { palletMappingId, palletId, occupiedBy }) {
    await sequelize.query(`
        UPDATE T_LOCATION
        SET Status = 'OCCUPIED', CurrentPalletMappingID = :palletMappingId, CurrentPalletID = :palletId,
            OccupiedBy = :occupiedBy, OccupiedAt = GETDATE(), UpdatedBy = :occupiedBy, UpdatedAt = GETDATE()
        WHERE LocationID = :locationId
    `, {
        replacements: { locationId, palletMappingId, palletId, occupiedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

module.exports = {
    getWarehouses,
    isWarehouseValid,
    getWarehouseSummary,
    getActiveRows,
    generatePositions,
    getAvailablePositions,
    findLocationByCombo,
    findLocationById,
    lockLocationById,
    createLocation,
    getLocationMappingHistoryCount,
    updateLocationCombo,
    setLocationStatus,
    occupyLocation
};
