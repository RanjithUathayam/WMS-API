const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

/** Item/quantity breakdown for every box mapped to a pallet, read from T_PREBIN_BOX/T_PREBIN_ITEM (never re-entered), grouped by box + item so multiple scans of the same item on a box collapse into one inventory row. */
async function getItemBreakdownForBoxes(transaction, palletMappingId) {
    return sequelize.query(`
        SELECT pmb.BoxNumber, pi.ItemCode, MAX(pi.ItemGroup) AS ItemGroup, SUM(pi.Qty) AS Quantity
        FROM T_PALLET_MAPPING_BOX pmb WITH (NOLOCK)
        INNER JOIN T_PREBIN_BOX pb WITH (NOLOCK) ON pb.BoxNumber = pmb.BoxNumber
        INNER JOIN T_PREBIN_ITEM pi WITH (NOLOCK) ON pi.PreBinBoxID = pb.PreBinBoxID
        WHERE pmb.PalletMappingID = :palletMappingId
        GROUP BY pmb.BoxNumber, pi.ItemCode
    `, {
        replacements: { palletMappingId },
        transaction,
        type: QueryTypes.SELECT
    });
}

/** Upserts one T_INVENTORY row on the (LocationID, PalletMappingID, BoxNumber, ItemCode) key — see sql/Inventory_Schema.sql. */
async function upsertInventoryRow(transaction, { warehouseCode, rowCode, locationId, locationCode, palletMappingId, palletId, boxNumber, itemCode, itemGroup, quantity, mappedBy }) {
    await sequelize.query(`
        MERGE T_INVENTORY WITH (HOLDLOCK) AS target
        USING (SELECT :locationId AS LocationID, :palletMappingId AS PalletMappingID, :boxNumber AS BoxNumber, :itemCode AS ItemCode) AS src
            ON target.LocationID = src.LocationID
           AND target.PalletMappingID = src.PalletMappingID
           AND target.BoxNumber = src.BoxNumber
           AND target.ItemCode = src.ItemCode
        WHEN MATCHED THEN
            UPDATE SET Quantity = :quantity, ItemGroup = :itemGroup, WarehouseCode = :warehouseCode, RowCode = :rowCode,
                       LocationCode = :locationCode, PalletID = :palletId, Status = 'AVAILABLE', UpdatedBy = :mappedBy, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID, BoxNumber, ItemCode, ItemGroup, Quantity, AllocatedQty, Status, CreatedBy, CreatedAt)
            VALUES (:warehouseCode, :rowCode, :locationId, :locationCode, :palletMappingId, :palletId, :boxNumber, :itemCode, :itemGroup, :quantity, 0, 'AVAILABLE', :mappedBy, GETDATE());
    `, {
        replacements: { warehouseCode, rowCode, locationId, locationCode, palletMappingId, palletId, boxNumber, itemCode, itemGroup, quantity, mappedBy },
        transaction,
        type: QueryTypes.INSERT
    });
}

module.exports = {
    getItemBreakdownForBoxes,
    upsertInventoryRow
};
