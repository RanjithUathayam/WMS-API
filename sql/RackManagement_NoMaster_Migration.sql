/*
    Rack Management — remove the Location Master dependency.
    Database: [WMS_NEW].[dbo]

    Business process: select warehouse -> scan Rack QR -> scan items -> Save creates/updates inventory.
    No master data is needed for a rack: a rack is identified by (WarehouseCode, LocationCode = scanned
    Rack QR) and comes into existence with its first saved Store. T_LOCATION is no longer referenced.

    What this script does (every statement is guarded, safe to run more than once):
      1. Drops the FKs from T_RACK_INVENTORY / T_RACK_TRANSACTION / T_RACK_ITEM_TAG to T_LOCATION.
      2. Makes LocationID nullable on those tables (kept only for backward compatibility, always NULL now).
      3. Adds T_RACK_ITEM_TAG.WarehouseCode (a labelled piece is stored in a rack of a warehouse).
      4. Re-keys rack stock as one row per (WarehouseCode, LocationCode, ItemCode).

    Run this BEFORE deploying the API build that contains the "no master data" rack service.
*/

-- 1. Foreign keys to T_LOCATION
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RACK_INVENTORY_LOCATION')
    ALTER TABLE dbo.T_RACK_INVENTORY DROP CONSTRAINT FK_RACK_INVENTORY_LOCATION;
GO
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RACK_TRANSACTION_LOCATION')
    ALTER TABLE dbo.T_RACK_TRANSACTION DROP CONSTRAINT FK_RACK_TRANSACTION_LOCATION;
GO
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RACK_ITEM_TAG_LOCATION')
    ALTER TABLE dbo.T_RACK_ITEM_TAG DROP CONSTRAINT FK_RACK_ITEM_TAG_LOCATION;
GO

-- Indexes that include LocationID must go before the column can be altered.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RACK_INVENTORY_LOCATION_ITEM' AND object_id = OBJECT_ID('dbo.T_RACK_INVENTORY'))
    DROP INDEX UX_RACK_INVENTORY_LOCATION_ITEM ON dbo.T_RACK_INVENTORY;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_ITEM_TAG_LOCATION' AND object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG'))
    DROP INDEX IX_RACK_ITEM_TAG_LOCATION ON dbo.T_RACK_ITEM_TAG;
GO

-- 2. LocationID nullable
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.T_RACK_INVENTORY') AND name = 'LocationID' AND is_nullable = 0)
    ALTER TABLE dbo.T_RACK_INVENTORY ALTER COLUMN LocationID INT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION') AND name = 'LocationID' AND is_nullable = 0)
    ALTER TABLE dbo.T_RACK_TRANSACTION ALTER COLUMN LocationID INT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG') AND name = 'LocationID' AND is_nullable = 0)
    ALTER TABLE dbo.T_RACK_ITEM_TAG ALTER COLUMN LocationID INT NULL;
GO

-- 3. Warehouse of the rack a labelled piece is stored in
IF COL_LENGTH('dbo.T_RACK_ITEM_TAG', 'WarehouseCode') IS NULL
    ALTER TABLE dbo.T_RACK_ITEM_TAG ADD WarehouseCode NVARCHAR(50) NULL;
GO

-- 4. New keys
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RACK_INVENTORY_RACK_ITEM' AND object_id = OBJECT_ID('dbo.T_RACK_INVENTORY'))
    CREATE UNIQUE INDEX UX_RACK_INVENTORY_RACK_ITEM ON dbo.T_RACK_INVENTORY(WarehouseCode, LocationCode, ItemCode);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_ITEM_TAG_RACK' AND object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG'))
    CREATE INDEX IX_RACK_ITEM_TAG_RACK ON dbo.T_RACK_ITEM_TAG(WarehouseCode, LocationCode, Status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_TRANSACTION_WAREHOUSE_RACK' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION'))
    CREATE INDEX IX_RACK_TRANSACTION_WAREHOUSE_RACK ON dbo.T_RACK_TRANSACTION(WarehouseCode, LocationCode);
GO
