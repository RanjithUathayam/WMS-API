const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

/** Sets the pallet's aggregate PickingStatus (PENDING | IN_PROGRESS | COMPLETED). Called inside the same transaction as the inventory deduction, after re-counting remaining pickable rows. */
async function updatePalletPickingStatus(transaction, palletMappingId, pickingStatus) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING SET PickingStatus = :pickingStatus WHERE PalletMappingID = :palletMappingId
    `, {
        replacements: { palletMappingId, pickingStatus },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Inserts one audit row per completed picking transaction. */
async function insertPickingHistory(transaction, {
    inventoryId, palletMappingId, palletId, boxNumber, itemCode, itemGroup,
    warehouseCode, locationCode, pickedQty, remainingQty, pickedBy
}) {
    const rows = await sequelize.query(`
        INSERT INTO T_PICKING_HISTORY
            (InventoryID, PalletMappingID, PalletID, BoxNumber, ItemCode, ItemGroup, WarehouseCode, LocationCode,
             PickedQty, RemainingQty, Status, PickedBy, PickedAt)
        OUTPUT INSERTED.PickingID, INSERTED.InventoryID, INSERTED.PalletMappingID, INSERTED.PalletID,
               INSERTED.BoxNumber, INSERTED.ItemCode, INSERTED.ItemGroup, INSERTED.WarehouseCode, INSERTED.LocationCode,
               INSERTED.PickedQty, INSERTED.RemainingQty, INSERTED.Status, INSERTED.PickedBy, INSERTED.PickedAt
        VALUES
            (:inventoryId, :palletMappingId, :palletId, :boxNumber, :itemCode, :itemGroup, :warehouseCode, :locationCode,
             :pickedQty, :remainingQty, 'COMPLETED', :pickedBy, GETDATE())
    `, {
        replacements: {
            inventoryId, palletMappingId, palletId, boxNumber, itemCode, itemGroup: itemGroup || null,
            warehouseCode: warehouseCode || null, locationCode: locationCode || null, pickedQty, remainingQty, pickedBy
        },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

module.exports = {
    updatePalletPickingStatus,
    insertPickingHistory
};
