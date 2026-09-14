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

/** All AVAILABLE (Quantity > 0) inventory lines for a pallet, joined to Master_Part for item name — used by Scan Pallet. */
async function getAvailableInventoryByPallet(palletMappingId) {
    return sequelize.query(`
        SELECT inv.InventoryID, inv.WarehouseCode, inv.RowCode, inv.LocationID, inv.LocationCode,
               inv.PalletMappingID, inv.PalletID, inv.BoxNumber, inv.ItemCode, inv.ItemGroup,
               inv.Quantity, inv.AllocatedQty, inv.Status,
               mp.ItemName AS ItemName
        FROM T_INVENTORY inv WITH (NOLOCK)
        LEFT JOIN Master_Part mp WITH (NOLOCK) ON mp.ItemCode = inv.ItemCode AND (mp.isDelete = 0 OR mp.isDelete IS NULL)
        WHERE inv.PalletMappingID = :palletMappingId AND inv.Status = 'AVAILABLE' AND inv.Quantity > 0
        ORDER BY inv.BoxNumber, inv.ItemCode
    `, {
        replacements: { palletMappingId },
        type: QueryTypes.SELECT
    });
}

/** Every inventory line (any status) for one box under a pallet, joined to Master_Part — used by Scan Box. */
async function getInventoryByPalletAndBox(palletMappingId, boxNumber) {
    return sequelize.query(`
        SELECT inv.InventoryID, inv.WarehouseCode, inv.RowCode, inv.LocationID, inv.LocationCode,
               inv.PalletMappingID, inv.PalletID, inv.BoxNumber, inv.ItemCode, inv.ItemGroup,
               inv.Quantity, inv.AllocatedQty, inv.Status,
               mp.ItemName AS ItemName
        FROM T_INVENTORY inv WITH (NOLOCK)
        LEFT JOIN Master_Part mp WITH (NOLOCK) ON mp.ItemCode = inv.ItemCode AND (mp.isDelete = 0 OR mp.isDelete IS NULL)
        WHERE inv.PalletMappingID = :palletMappingId AND inv.BoxNumber = :boxNumber
        ORDER BY inv.ItemCode
    `, {
        replacements: { palletMappingId, boxNumber },
        type: QueryTypes.SELECT
    });
}

/** True if boxNumber exists in T_INVENTORY at all (for any pallet) — distinguishes BOX_NOT_FOUND from BOX_NOT_IN_PALLET. */
async function boxExistsInInventory(boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 1 AS found FROM T_INVENTORY WITH (NOLOCK) WHERE BoxNumber = :boxNumber
    `, {
        replacements: { boxNumber },
        type: QueryTypes.SELECT
    });
    return rows.length > 0;
}

/** Locks the single (pallet, box, item) inventory row for the Complete Picking deduction. Locked AFTER the pallet mapping row, to keep a fixed lock order across concurrent picks. */
async function lockInventoryRow(transaction, { palletMappingId, boxNumber, itemCode }) {
    const rows = await sequelize.query(`
        SELECT InventoryID, WarehouseCode, RowCode, LocationID, LocationCode, PalletMappingID, PalletID,
               BoxNumber, ItemCode, ItemGroup, Quantity, AllocatedQty, Status
        FROM T_INVENTORY WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PalletMappingID = :palletMappingId AND BoxNumber = :boxNumber AND ItemCode = :itemCode
    `, {
        replacements: { palletMappingId, boxNumber, itemCode },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Deducts pickedQty from an already-locked inventory row. Flips Status to CLEARED once Quantity hits 0. Never allows Quantity to go negative (caller must validate pickedQty <= Quantity beforehand, under the same lock). */
async function deductInventoryQty(transaction, inventoryId, { remainingQty, updatedBy }) {
    await sequelize.query(`
        UPDATE T_INVENTORY
        SET Quantity = :remainingQty,
            Status = CASE WHEN :remainingQty <= 0 THEN 'CLEARED' ELSE 'AVAILABLE' END,
            UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
        WHERE InventoryID = :inventoryId
    `, {
        replacements: { inventoryId, remainingQty, updatedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Count of still-pickable (AVAILABLE, Quantity > 0) inventory rows remaining for a pallet — used to decide whether picking is now COMPLETED for the whole pallet. Read inside the same transaction as the deduction so it reflects the just-applied change. */
async function countAvailableInventoryForPallet(transaction, palletMappingId) {
    const rows = await sequelize.query(`
        SELECT COUNT(*) AS cnt
        FROM T_INVENTORY WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PalletMappingID = :palletMappingId AND Status = 'AVAILABLE' AND Quantity > 0
    `, {
        replacements: { palletMappingId },
        transaction,
        type: QueryTypes.SELECT
    });
    return Number(rows[0].cnt);
}

module.exports = {
    getItemBreakdownForBoxes,
    upsertInventoryRow,
    getAvailableInventoryByPallet,
    getInventoryByPalletAndBox,
    boxExistsInInventory,
    lockInventoryRow,
    deductInventoryQty,
    countAvailableInventoryForPallet
};
