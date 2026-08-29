/*
    Pallet Mapping Process — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [dbo].[T_PREBIN_BOX]  (Sequelize model: models/HHT/preBinBox.js)
            -> Box master for this process. A box only becomes eligible for pallet mapping once
               its Pre-Binning workflow has finished (Status = 'COMPLETED') — see
               repository/palletMappingRepository.js: findPrebinBoxByNumber, lockPrebinBoxByNumber.
               No second box table is introduced here; T_PREBIN_BOX stays the single source of
               truth for box identity/eligibility.

    New objects (this process only):
      - T_PALLET_MAPPING      — one row per physical pallet while/after boxes are being mapped to it
      - T_PALLET_MAPPING_BOX  — one row per box mapped onto a pallet

    Design decisions (confirm with the business if these assumptions are wrong):
      1. A PalletID is single-use for its whole lifetime: once a pallet mapping is COMPLETED it can
         never be reopened or reused (mirrors T_PREBIN_BOX's BoxNumber lifecycle exactly — see
         repository.lockLatestPalletByPalletId / service.describePalletState). The unique index below
         only needs to cover the OPEN state — it stops two concurrent scanners from creating two
         different open mappings for the same brand-new PalletID.
      2. A BoxNumber may be mapped to exactly one pallet, ever — UX_PALLET_MAPPING_BOX_BOXNUMBER is a
         plain (non-filtered) unique index across the whole table. This single index is what backs
         "box not already mapped to another pallet" AND "box not duplicated in the current pallet"
         AND protects against two operators mapping the same box concurrently to different pallets.
      3. WarehouseCode/ItemGroup/BoxTotalQty on T_PALLET_MAPPING_BOX are a point-in-time copy taken
         from T_PREBIN_BOX at mapping time, for display/audit only — T_PREBIN_BOX remains the source
         of truth for the box's own attributes.
*/

IF OBJECT_ID('dbo.T_PALLET_MAPPING', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PALLET_MAPPING
    (
        PalletMappingID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PalletID        NVARCHAR(100)   NOT NULL,
        TotalBoxCount   INT             NOT NULL DEFAULT 0,
        Status          NVARCHAR(20)    NOT NULL DEFAULT 'OPEN', -- OPEN | COMPLETED
        CreatedBy       NVARCHAR(100)   NOT NULL,
        CreatedAt       DATETIME        NOT NULL DEFAULT GETDATE(),
        CompletedBy     NVARCHAR(100)   NULL,
        CompletedAt     DATETIME        NULL
    );
END
GO

IF OBJECT_ID('dbo.T_PALLET_MAPPING_BOX', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PALLET_MAPPING_BOX
    (
        PalletMappingBoxID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PalletMappingID     INT            NOT NULL,
        PalletID             NVARCHAR(100)  NOT NULL,
        BoxNumber            NVARCHAR(100)  NOT NULL,
        WarehouseCode        NVARCHAR(50)   NULL,
        ItemGroup            NVARCHAR(100)  NULL,
        BoxTotalQty          DECIMAL(18,3)  NULL,
        MappedBy             NVARCHAR(100)  NOT NULL,
        MappedAt             DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_PALLET_MAPPING_BOX_PALLET FOREIGN KEY (PalletMappingID)
            REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PALLET_MAPPING_OPEN' AND object_id = OBJECT_ID('dbo.T_PALLET_MAPPING'))
BEGIN
    CREATE UNIQUE INDEX UX_PALLET_MAPPING_OPEN
        ON dbo.T_PALLET_MAPPING(PalletID)
        WHERE Status = 'OPEN';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PALLET_MAPPING_PALLETID' AND object_id = OBJECT_ID('dbo.T_PALLET_MAPPING'))
    CREATE INDEX IX_PALLET_MAPPING_PALLETID ON dbo.T_PALLET_MAPPING(PalletID);
GO

-- Enforced at the DB level so two concurrent mapping requests can never both accept the same
-- BoxNumber, whether racing onto the same pallet or two different pallets.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PALLET_MAPPING_BOX_BOXNUMBER' AND object_id = OBJECT_ID('dbo.T_PALLET_MAPPING_BOX'))
    CREATE UNIQUE INDEX UX_PALLET_MAPPING_BOX_BOXNUMBER ON dbo.T_PALLET_MAPPING_BOX(BoxNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PALLET_MAPPING_BOX_MAPPINGID' AND object_id = OBJECT_ID('dbo.T_PALLET_MAPPING_BOX'))
    CREATE INDEX IX_PALLET_MAPPING_BOX_MAPPINGID ON dbo.T_PALLET_MAPPING_BOX(PalletMappingID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PALLET_MAPPING_BOX_PALLETID' AND object_id = OBJECT_ID('dbo.T_PALLET_MAPPING_BOX'))
    CREATE INDEX IX_PALLET_MAPPING_BOX_PALLETID ON dbo.T_PALLET_MAPPING_BOX(PalletID);
GO
