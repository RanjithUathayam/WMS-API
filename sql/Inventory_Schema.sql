/*
    Inventory — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [dbo].[T_LOCATION] / [dbo].[T_LOCATION_MAPPING]  (sql/Location_Schema.sql)
      - [dbo].[T_PALLET_MAPPING] / [dbo].[T_PALLET_MAPPING_BOX]
      - [dbo].[T_PREBIN_BOX] / [dbo].[T_PREBIN_ITEM]
            -> Item/quantity breakdown per box is read from these, never re-entered. See
               repository/inventoryRepository.js: getItemBreakdownForBoxes.

    New objects (this process only):
      - T_INVENTORY — final physical position: Warehouse -> Location -> Pallet -> Box -> ItemCode -> Qty

    Design decisions (confirm with the business if these assumptions are wrong):
      1. Upsert key is (LocationID, PalletMappingID, BoxNumber, ItemCode) — all existing system
         identifiers, no re-derived compound business key. A successful Location Mapping upserts one
         row per distinct ItemCode found across the pallet's mapped boxes.
      2. AllocatedQty is provisioned but always 0 in this pass — no existing order/picking process
         reads HHT inventory yet, so there is nothing to allocate against. AvailableQty is computed by
         the application as Quantity - AllocatedQty, not stored.
      3. Status ('AVAILABLE' | 'CLEARED') is provisioned for a future relocation/unmap feature (see
         sql/Location_Schema.sql note on T_LOCATION_MAPPING.Action); not exercised by this pass.
*/

IF OBJECT_ID('dbo.T_INVENTORY', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_INVENTORY
    (
        InventoryID       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        WarehouseCode     NVARCHAR(50)   NOT NULL,
        RowCode           NVARCHAR(50)   NOT NULL,
        LocationID        INT            NOT NULL,
        LocationCode      NVARCHAR(150)  NULL,
        PalletMappingID   INT            NOT NULL,
        PalletID          NVARCHAR(100)  NULL,
        BoxNumber         NVARCHAR(100)  NOT NULL,
        ItemCode          NVARCHAR(100)  NOT NULL,
        ItemGroup         NVARCHAR(100)  NULL,
        Quantity          DECIMAL(18,3)  NOT NULL DEFAULT 0,
        AllocatedQty      DECIMAL(18,3)  NOT NULL DEFAULT 0,
        Status            NVARCHAR(20)   NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | CLEARED
        CreatedBy         NVARCHAR(100)  NOT NULL,
        CreatedAt         DATETIME       NOT NULL DEFAULT GETDATE(),
        UpdatedBy         NVARCHAR(100)  NULL,
        UpdatedAt         DATETIME       NULL,

        CONSTRAINT FK_INVENTORY_LOCATION FOREIGN KEY (LocationID)
            REFERENCES dbo.T_LOCATION (LocationID),
        CONSTRAINT FK_INVENTORY_PALLET_MAPPING FOREIGN KEY (PalletMappingID)
            REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID)
    );
END
GO

-- The upsert key (section: Inventory Upsert) — ID-based, no duplicate rows for the same physical stock.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_INVENTORY_KEY' AND object_id = OBJECT_ID('dbo.T_INVENTORY'))
    CREATE UNIQUE INDEX UX_INVENTORY_KEY ON dbo.T_INVENTORY(LocationID, PalletMappingID, BoxNumber, ItemCode);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_INVENTORY_WAREHOUSE' AND object_id = OBJECT_ID('dbo.T_INVENTORY'))
    CREATE INDEX IX_INVENTORY_WAREHOUSE ON dbo.T_INVENTORY(WarehouseCode, RowCode, Status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_INVENTORY_ITEMCODE' AND object_id = OBJECT_ID('dbo.T_INVENTORY'))
    CREATE INDEX IX_INVENTORY_ITEMCODE ON dbo.T_INVENTORY(ItemCode);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_INVENTORY_PALLETMAPPINGID' AND object_id = OBJECT_ID('dbo.T_INVENTORY'))
    CREATE INDEX IX_INVENTORY_PALLETMAPPINGID ON dbo.T_INVENTORY(PalletMappingID);
GO
