/*
    Pre-Binning Process — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [dbo].[OITW] / [dbo].[OITM] / [dbo].[OWHS]  (SAP Business One tables, replicated here)
            -> Live warehouse stock. See repository/preBinningRepository.js: getWarehouseStock,
               getPreBinningWarehouses, and the per-scan stock lock all read these directly.
      - [dbo].[ERP_Pre_Binning]  (Sequelize model: models/ERP_API/PreBinning.js)
            -> Reference only, and only at box completion. GRNNo is parsed off the item QR for the
               Item Scan response, but it is NOT validated during scanning and NOT stored on
               T_PREBIN_ITEM at all. At box completion, repository.findGrnForItem resolves the best
               matching ERP_Pre_Binning row by ItemCode + ItemGroup to populate T_BIN_COMPLETE's
               (NOT NULL) GRNNo column — ambiguous if an item legitimately spans multiple open GRNs.
      - [dbo].[T_BIN_COMPLETE]   (Sequelize model: models/HHT/binComplete.js)
            -> Final bin-completion record, written once per box on CompleteBoxAsync. WhsCode is
               added below (nullable, for backward compatibility with pre-existing rows).

    New objects (this process only):
      - T_PREBIN_BOX  — one row per physical box while/after it is being filled
      - T_PREBIN_ITEM — one row per scanned unit inside a box

    Design decisions (confirm with the business if these assumptions are wrong):
      1. UniqueNumber only has to be unique within its ItemCode (UX_PREBIN_ITEM_ITEMCODE_UNIQUE),
         not globally — the same UniqueNumber value may recur under a different ItemCode.
      2. A BoxNumber is single-use for its whole lifetime: once a box is COMPLETED it can never be
         reopened or reused (repository.lockLatestBoxByNumber/findLatestBoxByNumber enforce this in
         application code). The unique index below only needs to cover the IN_PROGRESS state — it
         stops two concurrent scanners from creating two different open boxes with the same brand
         new number, and guarantees at most one warehouse can have a given number open at a time.
*/

IF OBJECT_ID('dbo.T_PREBIN_BOX', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PREBIN_BOX
    (
        PreBinBoxID     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BoxNumber       NVARCHAR(100)   NOT NULL,
        WarehouseCode   NVARCHAR(50)    NOT NULL,
        ItemGroup       NVARCHAR(100)   NULL,
        TotalQty        DECIMAL(18,3)   NOT NULL DEFAULT 0,
        Status          NVARCHAR(20)    NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS | COMPLETED
        CreatedBy       NVARCHAR(100)   NOT NULL,
        CreatedAt       DATETIME        NOT NULL DEFAULT GETDATE(),
        CompletedBy     NVARCHAR(100)   NULL,
        CompletedAt     DATETIME        NULL
    );
END
GO

IF OBJECT_ID('dbo.T_PREBIN_ITEM', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PREBIN_ITEM
    (
        PreBinItemID    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PreBinBoxID     INT             NOT NULL,
        WarehouseCode   NVARCHAR(50)    NOT NULL,
        ItemCode        NVARCHAR(100)   NOT NULL,
        Type            NVARCHAR(50)    NULL,
        ItemGroup       NVARCHAR(100)   NOT NULL,
        UniqueNumber    NVARCHAR(100)   NOT NULL,
        Qty             DECIMAL(18,3)   NOT NULL,
        ScannedBy       NVARCHAR(100)   NOT NULL,
        ScannedAt       DATETIME        NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_PREBIN_ITEM_BOX FOREIGN KEY (PreBinBoxID)
            REFERENCES dbo.T_PREBIN_BOX (PreBinBoxID)
    );
END
ELSE IF COL_LENGTH('dbo.T_PREBIN_ITEM', 'WarehouseCode') IS NULL
BEGIN
    -- Upgrading from an earlier version of this schema that didn't carry WarehouseCode per item.
    ALTER TABLE dbo.T_PREBIN_ITEM ADD WarehouseCode NVARCHAR(50) NULL;

    UPDATE i
    SET i.WarehouseCode = b.WarehouseCode
    FROM dbo.T_PREBIN_ITEM i
    INNER JOIN dbo.T_PREBIN_BOX b ON b.PreBinBoxID = i.PreBinBoxID
    WHERE i.WarehouseCode IS NULL;

    ALTER TABLE dbo.T_PREBIN_ITEM ALTER COLUMN WarehouseCode NVARCHAR(50) NOT NULL;
END
GO

IF COL_LENGTH('dbo.T_PREBIN_ITEM', 'GRNNo') IS NOT NULL
BEGIN
    -- GRNNo is no longer stored per scan (see findGrnForItem) — drop any index referencing it first.
    DECLARE @dropGrnIndexSql NVARCHAR(MAX) = N'';
    SELECT @dropGrnIndexSql = @dropGrnIndexSql + N'DROP INDEX ' + QUOTENAME(i.name) + N' ON dbo.T_PREBIN_ITEM;' + CHAR(10)
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('dbo.T_PREBIN_ITEM') AND c.name = 'GRNNo';

    IF @dropGrnIndexSql <> N'' EXEC sp_executesql @dropGrnIndexSql;

    ALTER TABLE dbo.T_PREBIN_ITEM DROP COLUMN GRNNo;
END
GO

IF COL_LENGTH('dbo.T_BIN_COMPLETE', 'WhsCode') IS NULL
BEGIN
    -- Nullable: pre-existing T_BIN_COMPLETE rows (from the older BinID-based binning flow) predate
    -- warehouse tracking and are left as NULL.
    ALTER TABLE dbo.T_BIN_COMPLETE ADD WhsCode NVARCHAR(50) NULL;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes i
    WHERE i.name = 'UX_PREBIN_BOX_OPEN' AND i.object_id = OBJECT_ID('dbo.T_PREBIN_BOX')
      AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id) > 1
)
BEGIN
    -- Upgrading from the earlier (BoxNumber, WarehouseCode) version of this index — a box number
    -- must now be unique across ALL warehouses while open, not just within one warehouse.
    DROP INDEX UX_PREBIN_BOX_OPEN ON dbo.T_PREBIN_BOX;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PREBIN_BOX_OPEN' AND object_id = OBJECT_ID('dbo.T_PREBIN_BOX'))
BEGIN
    CREATE UNIQUE INDEX UX_PREBIN_BOX_OPEN
        ON dbo.T_PREBIN_BOX(BoxNumber)
        WHERE Status = 'IN_PROGRESS';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_BOX_BOXNUMBER' AND object_id = OBJECT_ID('dbo.T_PREBIN_BOX'))
    CREATE INDEX IX_PREBIN_BOX_BOXNUMBER ON dbo.T_PREBIN_BOX(BoxNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_BOX_WAREHOUSE' AND object_id = OBJECT_ID('dbo.T_PREBIN_BOX'))
    CREATE INDEX IX_PREBIN_BOX_WAREHOUSE ON dbo.T_PREBIN_BOX(WarehouseCode, BoxNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_ITEM_BOX' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    CREATE INDEX IX_PREBIN_ITEM_BOX ON dbo.T_PREBIN_ITEM(PreBinBoxID);
GO

-- Superseded by UX_PREBIN_ITEM_ITEMCODE_UNIQUE below (UniqueNumber is scoped to ItemCode now, not global).
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PREBIN_ITEM_UNIQUE_NUMBER' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    DROP INDEX UX_PREBIN_ITEM_UNIQUE_NUMBER ON dbo.T_PREBIN_ITEM;
GO

-- Enforced at the DB level so two concurrent scans can never both accept the same UniqueNumber
-- for the same ItemCode (the same number may recur under a different ItemCode).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PREBIN_ITEM_ITEMCODE_UNIQUE' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    CREATE UNIQUE INDEX UX_PREBIN_ITEM_ITEMCODE_UNIQUE ON dbo.T_PREBIN_ITEM(ItemCode, UniqueNumber);
GO

-- Covers the balance check against live SAP stock (identity = WhsCode + ItemCode).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_ITEM_WH_ITEM' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    CREATE INDEX IX_PREBIN_ITEM_WH_ITEM ON dbo.T_PREBIN_ITEM(WarehouseCode, ItemCode);
GO

-- Duplicate of IX_PREBIN_ITEM_WH_ITEM from an earlier revision of this script — drop if present.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_ITEM_WH_GRN_ITEM' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    DROP INDEX IX_PREBIN_ITEM_WH_GRN_ITEM ON dbo.T_PREBIN_ITEM;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PREBIN_ITEM_GRN_ITEM' AND object_id = OBJECT_ID('dbo.T_PREBIN_ITEM'))
    CREATE INDEX IX_PREBIN_ITEM_GRN_ITEM ON dbo.T_PREBIN_ITEM(ItemCode, ItemGroup);
GO
