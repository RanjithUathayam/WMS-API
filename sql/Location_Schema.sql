/*
    Location Master + Location Mapping — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [BBLive].[dbo].OWHS / OITW / OITM (SAP Business One, cross-database)
            -> Warehouse identity. There is no local Warehouse master anywhere in this codebase;
               see repository/preBinningRepository.js: getPreBinningWarehouses/isWarehouseAllowed.
      - [dbo].[T_PALLET_MAPPING] / [dbo].[T_PALLET_MAPPING_BOX]
            -> A Location Mapping always targets an already-COMPLETED pallet mapping. No pallet/box
               data is duplicated here; T_LOCATION_MAPPING only stores the PalletMappingID/PalletID.

    New objects (this process only):
      - T_LOCATION          — Location Master, current state (one row per physical location, forever)
      - T_LOCATION_ROW      — Row master (Name/DisplayOrder/Active-Inactive), independent of positions
      - T_LOCATION_MAPPING  — append-only audit trail of pallet <-> location assignment events

    Design decisions (confirm with the business if these assumptions are wrong):
      1. T_LOCATION_ROW is a Row master table: Rows now have an independent lifecycle (Name,
         DisplayOrder, Active/Inactive) that isn't derivable from T_LOCATION alone — e.g. a Row can
         be created before it has any positions. RowCode/WarehouseCode on T_LOCATION are still the
         join key into this table (matched by value, not by RowID), so no FK is declared — T_LOCATION
         rows are never deleted or renamed to follow a Row edit.
      2. (WarehouseCode, RowCode, PositionNo) is permanently unique (NOT filtered by Status) — a
         location is never deleted, only moved to Status='INACTIVE', so the combination can never be
         reused for a different physical slot.
      3. T_LOCATION.Status is the single state field covering AVAILABLE|OCCUPIED|BLOCKED|INACTIVE —
         no separate IsActive bit, since INACTIVE already represents "deactivated."
      4. T_LOCATION.CurrentPalletMappingID/CurrentPalletID/OccupiedBy/OccupiedAt are a denormalized
         cache of T_LOCATION_MAPPING's current ACTIVE row for this location, kept in sync in the same
         transaction that inserts the mapping row. This lets "available positions"/location lookups
         read T_LOCATION alone, no join, per the read-minimization requirement.
      5. T_LOCATION_MAPPING is append-only: mapping a pallet inserts a new Status='ACTIVE' row. Only
         one ACTIVE row may exist per PalletMappingID and per LocationID at any time (unique filtered
         indexes below) — this is both the audit trail (who/when/previous location) and the DB-level
         concurrency backstop. Action/PreviousLocationID/Status='SUPERSEDED' are provisioned for a
         future relocation/unmap feature, which is out of scope for this pass (the acceptance flow
         only maps forward: position -> pallet -> next position -> next pallet).
*/

IF OBJECT_ID('dbo.T_LOCATION', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LOCATION
    (
        LocationID              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        WarehouseCode           NVARCHAR(50)   NOT NULL,
        RowCode                 NVARCHAR(50)   NOT NULL,
        PositionNo              INT            NOT NULL,
        LocationCode            NVARCHAR(150)  NOT NULL,
        Status                  NVARCHAR(20)   NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | OCCUPIED | BLOCKED | INACTIVE
        CurrentPalletMappingID  INT            NULL,
        CurrentPalletID         NVARCHAR(100)  NULL,
        OccupiedBy              NVARCHAR(100)  NULL,
        OccupiedAt              DATETIME       NULL,
        CreatedBy               NVARCHAR(100)  NOT NULL,
        CreatedAt               DATETIME       NOT NULL DEFAULT GETDATE(),
        UpdatedBy               NVARCHAR(100)  NULL,
        UpdatedAt               DATETIME       NULL,

        CONSTRAINT FK_LOCATION_CURRENT_PALLET_MAPPING FOREIGN KEY (CurrentPalletMappingID)
            REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID)
    );
END
GO

IF OBJECT_ID('dbo.T_LOCATION_ROW', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LOCATION_ROW
    (
        RowID         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        WarehouseCode NVARCHAR(50)  NOT NULL,
        RowCode       NVARCHAR(50)  NOT NULL,
        RowName       NVARCHAR(150) NULL,
        DisplayOrder  INT           NOT NULL DEFAULT 0,
        Status        NVARCHAR(20)  NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | INACTIVE
        CreatedBy     NVARCHAR(100) NOT NULL,
        CreatedAt     DATETIME      NOT NULL DEFAULT GETDATE(),
        UpdatedBy     NVARCHAR(100) NULL,
        UpdatedAt     DATETIME      NULL
    );
END
GO

IF OBJECT_ID('dbo.T_LOCATION_MAPPING', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LOCATION_MAPPING
    (
        LocationMappingID  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        LocationID         INT            NOT NULL,
        LocationCode       NVARCHAR(150)  NULL,
        WarehouseCode      NVARCHAR(50)   NULL,
        RowCode            NVARCHAR(50)   NULL,
        PositionNo         INT            NULL,
        PalletMappingID    INT            NOT NULL,
        PalletID           NVARCHAR(100)  NULL,
        Action             NVARCHAR(20)   NOT NULL DEFAULT 'MAPPED', -- MAPPED | UNMAPPED | MOVED
        PreviousLocationID INT            NULL,
        Status             NVARCHAR(20)   NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | SUPERSEDED
        MappedBy           NVARCHAR(100)  NOT NULL,
        MappedAt           DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_LOCATION_MAPPING_LOCATION FOREIGN KEY (LocationID)
            REFERENCES dbo.T_LOCATION (LocationID),
        CONSTRAINT FK_LOCATION_MAPPING_PALLET FOREIGN KEY (PalletMappingID)
            REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID)
    );
END
GO

-- A Row Code is unique within a Warehouse.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LOCATION_ROW_WH_ROWCODE' AND object_id = OBJECT_ID('dbo.T_LOCATION_ROW'))
    CREATE UNIQUE INDEX UX_LOCATION_ROW_WH_ROWCODE ON dbo.T_LOCATION_ROW(WarehouseCode, RowCode);
GO

-- Permanent uniqueness for the physical slot identity (never filtered — locations are never deleted).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LOCATION_WH_ROW_POS' AND object_id = OBJECT_ID('dbo.T_LOCATION'))
    CREATE UNIQUE INDEX UX_LOCATION_WH_ROW_POS ON dbo.T_LOCATION(WarehouseCode, RowCode, PositionNo);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LOCATION_CODE' AND object_id = OBJECT_ID('dbo.T_LOCATION'))
    CREATE UNIQUE INDEX UX_LOCATION_CODE ON dbo.T_LOCATION(LocationCode);
GO

-- Backs "Get Rows" and "Get Available Positions", the hottest Location Master reads.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LOCATION_WH_ROW_STATUS' AND object_id = OBJECT_ID('dbo.T_LOCATION'))
    CREATE INDEX IX_LOCATION_WH_ROW_STATUS ON dbo.T_LOCATION(WarehouseCode, RowCode, Status);
GO

-- DB-level backstop: a pallet can hold at most one ACTIVE location mapping at any time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LOCMAP_ACTIVE_PALLET' AND object_id = OBJECT_ID('dbo.T_LOCATION_MAPPING'))
    CREATE UNIQUE INDEX UX_LOCMAP_ACTIVE_PALLET ON dbo.T_LOCATION_MAPPING(PalletMappingID) WHERE Status = 'ACTIVE';
GO

-- DB-level backstop: a location can hold at most one ACTIVE pallet at any time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LOCMAP_ACTIVE_LOCATION' AND object_id = OBJECT_ID('dbo.T_LOCATION_MAPPING'))
    CREATE UNIQUE INDEX UX_LOCMAP_ACTIVE_LOCATION ON dbo.T_LOCATION_MAPPING(LocationID) WHERE Status = 'ACTIVE';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LOCATION_MAPPING_LOCATIONID' AND object_id = OBJECT_ID('dbo.T_LOCATION_MAPPING'))
    CREATE INDEX IX_LOCATION_MAPPING_LOCATIONID ON dbo.T_LOCATION_MAPPING(LocationID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LOCATION_MAPPING_PALLETMAPPINGID' AND object_id = OBJECT_ID('dbo.T_LOCATION_MAPPING'))
    CREATE INDEX IX_LOCATION_MAPPING_PALLETMAPPINGID ON dbo.T_LOCATION_MAPPING(PalletMappingID);
GO
