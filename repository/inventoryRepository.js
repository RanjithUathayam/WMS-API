const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

/**
 * Batched item/quantity breakdown for a set of BoxNumbers, derived from the existing Prebinning
 * data (T_PREBIN_BOX/T_PREBIN_ITEM) — never re-entered. One query for every box on the pallet
 * (avoids N+1). Mirrors the "latest row per BoxNumber wins" convention already used by
 * repository/palletMappingRepository.js: findPrebinBoxByNumber / lockPrebinBoxByNumber.
 */
async function getItemBreakdownForBoxes(transaction, boxNumbers) {
    if (!boxNumbers || boxNumbers.length === 0) return [];
    return sequelize.query(`
        WITH LatestBox AS (
            SELECT PreBinBoxID, BoxNumber,
                   ROW_NUMBER() OVER (PARTITION BY BoxNumber ORDER BY CreatedAt DESC) AS rn
            FROM T_PREBIN_BOX WITH (NOLOCK)
            WHERE BoxNumber IN (:boxNumbers)
        )
        SELECT lb.BoxNumber AS boxNumber, pi.ItemCode AS itemCode, pi.ItemGroup AS itemGroup,
               CAST(SUM(pi.Qty) AS DECIMAL(18,3)) AS qty
        FROM LatestBox lb
        INNER JOIN T_PREBIN_ITEM pi WITH (NOLOCK) ON pi.PreBinBoxID = lb.PreBinBoxID
        WHERE lb.rn = 1
        GROUP BY lb.BoxNumber, pi.ItemCode, pi.ItemGroup
    `, {
        replacements: { boxNumbers },
        transaction,
        type: QueryTypes.SELECT
    });
}

/**
 * Upserts one inventory row keyed on (LocationID, PalletMappingID, BoxNumber, ItemCode) —
 * UPDATE first, INSERT only if no row exists, so a retried/duplicate mapping never doubles a
 * quantity or creates a second row for the same physical stock.
 */
async function upsertInventoryRow(transaction, { warehouseCode, rowCode, locationId, locationCode, palletMappingId, palletId, boxNumber, itemCode, itemGroup, quantity, userName }) {
    const existing = await sequelize.query(`
        SELECT TOP 1 InventoryID
        FROM T_INVENTORY WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE LocationID = :locationId AND PalletMappingID = :palletMappingId
              AND BoxNumber = :boxNumber AND ItemCode = :itemCode
    `, {
        replacements: { locationId, palletMappingId, boxNumber, itemCode },
        transaction,
        type: QueryTypes.SELECT
    });

    if (existing[0]) {
        await sequelize.query(`
            UPDATE T_INVENTORY
            SET Quantity = :quantity, ItemGroup = :itemGroup, Status = 'AVAILABLE',
                UpdatedBy = :userName, UpdatedAt = GETDATE()
            WHERE InventoryID = :inventoryId
        `, {
            replacements: { inventoryId: existing[0].InventoryID, itemGroup, quantity, userName },
            transaction,
            type: QueryTypes.UPDATE
        });
        return;
    }

    await sequelize.query(`
        INSERT INTO T_INVENTORY
            (WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID, BoxNumber,
             ItemCode, ItemGroup, Quantity, AllocatedQty, Status, CreatedBy, CreatedAt)
        VALUES
            (:warehouseCode, :rowCode, :locationId, :locationCode, :palletMappingId, :palletId, :boxNumber,
             :itemCode, :itemGroup, :quantity, 0, 'AVAILABLE', :userName, GETDATE())
    `, {
        replacements: { warehouseCode, rowCode, locationId, locationCode, palletMappingId, palletId, boxNumber, itemCode, itemGroup, quantity, userName },
        transaction,
        type: QueryTypes.INSERT
    });
}

async function getInventorySummary({ warehouseCode, rowCode }) {
    const inventoryRows = await sequelize.query(`
        SELECT
            COUNT(DISTINCT PalletMappingID) AS totalPallets,
            COUNT(DISTINCT CONCAT(PalletMappingID, '|', BoxNumber)) AS totalBoxes,
            ISNULL(SUM(Quantity), 0) AS totalQuantity,
            ISNULL(SUM(Quantity - AllocatedQty), 0) AS availableQuantity,
            ISNULL(SUM(AllocatedQty), 0) AS allocatedQuantity
        FROM T_INVENTORY WITH (NOLOCK)
        WHERE Status = 'AVAILABLE'
              AND (:warehouseCode IS NULL OR WarehouseCode = :warehouseCode)
              AND (:rowCode IS NULL OR RowCode = :rowCode)
    `, {
        replacements: { warehouseCode: warehouseCode || null, rowCode: rowCode || null },
        type: QueryTypes.SELECT
    });

    const locationRows = await sequelize.query(`
        SELECT
            SUM(CASE WHEN Status = 'OCCUPIED' THEN 1 ELSE 0 END) AS occupiedLocations,
            SUM(CASE WHEN Status = 'AVAILABLE' THEN 1 ELSE 0 END) AS availableLocations
        FROM T_LOCATION WITH (NOLOCK)
        WHERE (:warehouseCode IS NULL OR WarehouseCode = :warehouseCode)
              AND (:rowCode IS NULL OR RowCode = :rowCode)
    `, {
        replacements: { warehouseCode: warehouseCode || null, rowCode: rowCode || null },
        type: QueryTypes.SELECT
    });

    return {
        ...inventoryRows[0],
        occupiedLocations: locationRows[0].occupiedLocations || 0,
        availableLocations: locationRows[0].availableLocations || 0
    };
}

function buildListFilters(filters) {
    const clauses = [];
    const replacements = {};

    const filterMap = {
        warehouseCode: 'WarehouseCode',
        rowCode: 'RowCode',
        locationId: 'LocationID',
        palletId: 'PalletID',
        boxNumber: 'BoxNumber',
        itemCode: 'ItemCode',
        itemGroup: 'ItemGroup',
        status: 'Status'
    };

    Object.keys(filterMap).forEach((key) => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
            clauses.push(`${filterMap[key]} = :${key}`);
            replacements[key] = filters[key];
        }
    });

    // Default to hiding CLEARED rows unless the caller explicitly asked to see them.
    if (!filters.status) {
        clauses.push("Status <> 'CLEARED'");
    }

    return { whereClause: clauses.length ? clauses.join(' AND ') : '1=1', replacements };
}

const SORTABLE_COLUMNS = {
    createdAt: 'CreatedAt',
    warehouseCode: 'WarehouseCode',
    locationCode: 'LocationCode',
    palletId: 'PalletID',
    boxNumber: 'BoxNumber',
    itemCode: 'ItemCode',
    quantity: 'Quantity'
};

async function getInventoryList(filters, { page, pageSize, sortBy, sortDir }) {
    const { whereClause, replacements } = buildListFilters(filters);
    const orderColumn = SORTABLE_COLUMNS[sortBy] || 'CreatedAt';
    const orderDir = String(sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const offset = (page - 1) * pageSize;

    const rows = await sequelize.query(`
        SELECT InventoryID, WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID,
               BoxNumber, ItemCode, ItemGroup, CAST(Quantity AS DECIMAL(18,3)) AS Quantity,
               CAST(AllocatedQty AS DECIMAL(18,3)) AS AllocatedQty, Status, CreatedAt, UpdatedAt
        FROM T_INVENTORY WITH (NOLOCK)
        WHERE ${whereClause}
        ORDER BY ${orderColumn} ${orderDir}
        OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
    `, {
        replacements: { ...replacements, offset, pageSize },
        type: QueryTypes.SELECT
    });

    const countRows = await sequelize.query(`
        SELECT COUNT(1) AS total FROM T_INVENTORY WITH (NOLOCK) WHERE ${whereClause}
    `, {
        replacements,
        type: QueryTypes.SELECT
    });

    return { rows, total: Number(countRows[0].total) };
}

async function getInventoryByLocationId(locationId) {
    return sequelize.query(`
        SELECT InventoryID, WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID,
               BoxNumber, ItemCode, ItemGroup, CAST(Quantity AS DECIMAL(18,3)) AS Quantity,
               CAST(AllocatedQty AS DECIMAL(18,3)) AS AllocatedQty, Status, CreatedAt, UpdatedAt
        FROM T_INVENTORY WITH (NOLOCK)
        WHERE LocationID = :locationId AND Status <> 'CLEARED'
        ORDER BY ItemCode
    `, {
        replacements: { locationId },
        type: QueryTypes.SELECT
    });
}

async function getInventoryByPalletMappingId(palletMappingId) {
    return sequelize.query(`
        SELECT InventoryID, WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID,
               BoxNumber, ItemCode, ItemGroup, CAST(Quantity AS DECIMAL(18,3)) AS Quantity,
               CAST(AllocatedQty AS DECIMAL(18,3)) AS AllocatedQty, Status, CreatedAt, UpdatedAt
        FROM T_INVENTORY WITH (NOLOCK)
        WHERE PalletMappingID = :palletMappingId AND Status <> 'CLEARED'
        ORDER BY BoxNumber, ItemCode
    `, {
        replacements: { palletMappingId },
        type: QueryTypes.SELECT
    });
}

module.exports = {
    getItemBreakdownForBoxes,
    upsertInventoryRow,
    getInventorySummary,
    getInventoryList,
    getInventoryByLocationId,
    getInventoryByPalletMappingId
};
