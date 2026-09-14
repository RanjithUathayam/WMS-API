/*
    Picking Process — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [dbo].[T_INVENTORY]  (sql/Inventory_Schema.sql)
            -> The physical stock ledger this whole process picks against: Warehouse -> Location ->
               Pallet -> Box -> ItemCode -> Qty. Picking is the FIRST process to actually decrement
               T_INVENTORY.Quantity (see repository/inventoryRepository.js: deductInventoryQty) —
               every prior process only ever wrote it via upsertInventoryRow's absolute-set MERGE.
               T_INVENTORY.Status ('AVAILABLE' | 'CLEARED') is reused as-is for box/item picking
               status: a row flips to CLEARED the moment its Quantity reaches 0, matching the enum
               this column was already provisioned with.
      - [dbo].[T_PALLET_MAPPING]  (sql/PalletMapping_Schema.sql)
            -> Only a mapping already COMPLETED (all boxes mapped) is ever eligible for picking.
               PickingStatus (added below) is a new, independent lifecycle on the SAME row —
               Status keeps meaning "has every box been mapped", PickingStatus means "has every
               box/item now been picked" — the two must not be conflated.

    New objects (this process only):
      - T_PALLET_MAPPING.PickingStatus (new column) — PENDING | IN_PROGRESS | COMPLETED
      - T_PICKING_HISTORY — one row per completed picking transaction (audit trail + history API)

    Design decisions (confirm with the business if these assumptions are wrong):
      1. No separate "reserve" step exists between Scan Box and Complete Picking (per the documented
         flow: Scan Pallet -> Scan Box -> Display -> Complete), so Complete Picking deducts directly
         from T_INVENTORY.Quantity. AllocatedQty is left untouched (always 0) — it remains reserved
         for a future allocate-before-pick feature, exactly as sql/Inventory_Schema.sql originally
         documented.
      2. A box/item combination (one T_INVENTORY row) can be picked in one shot only: once picked
         Quantity reaches 0 the row flips to Status='CLEARED' and can never be picked again (checked
         under the same row lock used for the deduction, so a concurrent duplicate request is
         rejected, not double-applied — no client idempotency key is introduced, matching how every
         other module in this codebase relies on row locks + unique indexes instead).
      3. T_PALLET_MAPPING.PickingStatus starts NULL for pre-existing rows and is only ever written by
         Complete Picking (PENDING on first read via the picking API's normalizer, IN_PROGRESS after
         the first successful pick, COMPLETED once no AVAILABLE inventory rows remain for that
         pallet). It never reopens once COMPLETED.
*/

IF COL_LENGTH('dbo.T_PALLET_MAPPING', 'PickingStatus') IS NULL
BEGIN
    ALTER TABLE dbo.T_PALLET_MAPPING ADD PickingStatus NVARCHAR(20) NULL; -- PENDING | IN_PROGRESS | COMPLETED
END
GO

IF OBJECT_ID('dbo.T_PICKING_HISTORY', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PICKING_HISTORY
    (
        PickingID         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        InventoryID       BIGINT         NOT NULL,
        PalletMappingID   INT            NOT NULL,
        PalletID          NVARCHAR(100)  NOT NULL,
        BoxNumber         NVARCHAR(100)  NOT NULL,
        ItemCode          NVARCHAR(100)  NOT NULL,
        ItemGroup         NVARCHAR(100)  NULL,
        WarehouseCode     NVARCHAR(50)   NULL,
        LocationCode      NVARCHAR(150)  NULL,
        PickedQty         DECIMAL(18,3)  NOT NULL,
        RemainingQty      DECIMAL(18,3)  NOT NULL,
        Status            NVARCHAR(20)   NOT NULL DEFAULT 'COMPLETED', -- COMPLETED (a picking transaction is a single atomic pick)
        PickedBy          NVARCHAR(100)  NOT NULL,
        PickedAt          DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_PICKING_HISTORY_INVENTORY FOREIGN KEY (InventoryID)
            REFERENCES dbo.T_INVENTORY (InventoryID),
        CONSTRAINT FK_PICKING_HISTORY_PALLET_MAPPING FOREIGN KEY (PalletMappingID)
            REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_PALLETID' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_PALLETID ON dbo.T_PICKING_HISTORY(PalletID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_BOXNUMBER' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_BOXNUMBER ON dbo.T_PICKING_HISTORY(BoxNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_ITEMCODE' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_ITEMCODE ON dbo.T_PICKING_HISTORY(ItemCode);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_PICKEDBY' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_PICKEDBY ON dbo.T_PICKING_HISTORY(PickedBy);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_PICKEDAT' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_PICKEDAT ON dbo.T_PICKING_HISTORY(PickedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICKING_HISTORY_PALLETMAPPINGID' AND object_id = OBJECT_ID('dbo.T_PICKING_HISTORY'))
    CREATE INDEX IX_PICKING_HISTORY_PALLETMAPPINGID ON dbo.T_PICKING_HISTORY(PalletMappingID);
GO
