/*
    Rack Management (Rack Store / Rack Picking) — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).

    Existing objects reused (NOT recreated here):
      - [dbo].[T_LOCATION]  (sql/Location_Schema.sql)
            -> A "Rack" IS a Location Master row. The Rack QR is the same printed LocationCode label
               Location Mapping already scans (see service/locationMappingService.js). No separate rack
               master is introduced; Location Master stays the single source of truth for rack
               identity and lifecycle (INACTIVE / BLOCKED locations reject rack store/picking).
      - [BBLive].[dbo].OITM (SAP Business One, cross-database) + [dbo].[Master_Part]
            -> Item validation / item name, same sources Pre-Binning and the reports already read.
      - Item QR format is the existing Pre-Binning label: ITEMCODE|TYPE|GRN NO|ITEMGROUP|UNIQUE NUMBER|QTY
            (service/preBinningService.js: parseItemQr). A bare ItemCode (no '|') is also accepted,
            with the quantity entered by the operator.

    New objects (this process only):
      - T_RACK_INVENTORY          — current loose-item stock per rack: Location -> ItemCode -> Qty
      - T_RACK_TRANSACTION        — one row per saved Store / Pick batch (header, audit trail)
      - T_RACK_TRANSACTION_DETAIL — one row per scanned line in a batch, with qty before/after
      - T_RACK_ITEM_TAG           — current state of each labelled piece (ItemCode+GRNNo+UniqueNumber)

    Design decisions (confirm with the business if these assumptions are wrong):
      1. Rack stock is kept in its own ledger, NOT in T_INVENTORY. T_INVENTORY.PalletMappingID is
         NOT NULL with an FK to T_PALLET_MAPPING and its unique key is (Location, Pallet, Box, Item);
         loose items stored straight into a rack have no pallet or box. Writing them there would
         require relaxing that table and would make them visible to pallet picking / Pick List
         inventory (which INNER JOIN T_PALLET_MAPPING), changing existing behaviour. A separate ledger
         keeps every existing process untouched.
      2. Rack Store / Picking does NOT change T_LOCATION.Status. A location's Status describes pallet
         occupancy (Location Mapping); flipping it to OCCUPIED for loose items would block pallet
         mapping there. Only INACTIVE / BLOCKED locations are rejected.
      3. T_RACK_ITEM_TAG gives each labelled piece one current state (STORED in a rack, or PICKED).
         It is the race-safe backstop for "duplicate scan" and "item not in this rack": a tag can be
         STORED once until it is picked, and a tag stored in rack A cannot be picked from rack B.
         Bare-ItemCode scans have no tag and are tracked at item-quantity level only.
      4. Idempotency: the client sends a ClientRequestId per Save; a unique filtered index makes a
         repeated Save (double click / network retry) return the original transaction instead of
         applying the inventory change twice.
      5. Quantity can never go negative (CHECK constraint + validation under row lock).
*/

IF OBJECT_ID('dbo.T_RACK_INVENTORY', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_RACK_INVENTORY
    (
        RackInventoryID   BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        LocationID        INT            NOT NULL,
        LocationCode      NVARCHAR(150)  NOT NULL,
        WarehouseCode     NVARCHAR(50)   NOT NULL,
        RowCode           NVARCHAR(50)   NULL,
        ItemCode          NVARCHAR(100)  NOT NULL,
        ItemGroup         NVARCHAR(100)  NULL,
        Quantity          DECIMAL(18,3)  NOT NULL CONSTRAINT DF_RACK_INVENTORY_QTY DEFAULT 0,
        CreatedBy         NVARCHAR(100)  NOT NULL,
        CreatedAt         DATETIME       NOT NULL CONSTRAINT DF_RACK_INVENTORY_CREATEDAT DEFAULT GETDATE(),
        UpdatedBy         NVARCHAR(100)  NULL,
        UpdatedAt         DATETIME       NULL,

        CONSTRAINT FK_RACK_INVENTORY_LOCATION FOREIGN KEY (LocationID)
            REFERENCES dbo.T_LOCATION (LocationID),
        CONSTRAINT CK_RACK_INVENTORY_QTY CHECK (Quantity >= 0)
    );
END
GO

-- One stock row per (rack, item).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RACK_INVENTORY_LOCATION_ITEM' AND object_id = OBJECT_ID('dbo.T_RACK_INVENTORY'))
    CREATE UNIQUE INDEX UX_RACK_INVENTORY_LOCATION_ITEM ON dbo.T_RACK_INVENTORY(LocationID, ItemCode);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_INVENTORY_ITEMCODE' AND object_id = OBJECT_ID('dbo.T_RACK_INVENTORY'))
    CREATE INDEX IX_RACK_INVENTORY_ITEMCODE ON dbo.T_RACK_INVENTORY(ItemCode) INCLUDE (LocationCode, Quantity);
GO

IF OBJECT_ID('dbo.T_RACK_TRANSACTION', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_RACK_TRANSACTION
    (
        RackTransactionID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TransactionType   NVARCHAR(10)   NOT NULL, -- STORE | PICK
        TransactionNo     AS (CAST(CASE WHEN TransactionType = 'STORE' THEN 'RS' ELSE 'RP' END
                              + RIGHT('00000000' + CAST(RackTransactionID AS VARCHAR(20)), 8) AS NVARCHAR(30))) PERSISTED,
        LocationID        INT            NOT NULL,
        LocationCode      NVARCHAR(150)  NOT NULL,
        WarehouseCode     NVARCHAR(50)   NOT NULL,
        RowCode           NVARCHAR(50)   NULL,
        TotalLines        INT            NOT NULL,
        TotalQty          DECIMAL(18,3)  NOT NULL,
        ClientRequestId   NVARCHAR(100)  NULL,
        DeviceID          NVARCHAR(100)  NULL,
        CreatedBy         NVARCHAR(100)  NOT NULL,
        CreatedAt         DATETIME       NOT NULL CONSTRAINT DF_RACK_TRANSACTION_CREATEDAT DEFAULT GETDATE(),

        CONSTRAINT FK_RACK_TRANSACTION_LOCATION FOREIGN KEY (LocationID)
            REFERENCES dbo.T_LOCATION (LocationID),
        CONSTRAINT CK_RACK_TRANSACTION_TYPE CHECK (TransactionType IN ('STORE', 'PICK'))
    );
END
GO

-- Duplicate-Save backstop (see design decision 4).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RACK_TRANSACTION_CLIENT_REQUEST' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION'))
    CREATE UNIQUE INDEX UX_RACK_TRANSACTION_CLIENT_REQUEST ON dbo.T_RACK_TRANSACTION(ClientRequestId) WHERE ClientRequestId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_TRANSACTION_CREATEDAT' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION'))
    CREATE INDEX IX_RACK_TRANSACTION_CREATEDAT ON dbo.T_RACK_TRANSACTION(CreatedAt, TransactionType);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_TRANSACTION_LOCATIONCODE' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION'))
    CREATE INDEX IX_RACK_TRANSACTION_LOCATIONCODE ON dbo.T_RACK_TRANSACTION(LocationCode);
GO

IF OBJECT_ID('dbo.T_RACK_TRANSACTION_DETAIL', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_RACK_TRANSACTION_DETAIL
    (
        RackTransactionDetailID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RackTransactionID       BIGINT         NOT NULL,
        LineNum                 INT            NOT NULL,
        RackInventoryID         BIGINT         NOT NULL,
        ItemCode                NVARCHAR(100)  NOT NULL,
        ItemGroup               NVARCHAR(100)  NULL,
        ItemType                NVARCHAR(50)   NULL,
        GRNNo                   NVARCHAR(100)  NULL,
        UniqueNumber            NVARCHAR(100)  NULL,
        Qty                     DECIMAL(18,3)  NOT NULL,
        QtyBefore               DECIMAL(18,3)  NOT NULL,
        QtyAfter                DECIMAL(18,3)  NOT NULL,

        CONSTRAINT FK_RACK_TRANSACTION_DETAIL_HEADER FOREIGN KEY (RackTransactionID)
            REFERENCES dbo.T_RACK_TRANSACTION (RackTransactionID),
        CONSTRAINT FK_RACK_TRANSACTION_DETAIL_INVENTORY FOREIGN KEY (RackInventoryID)
            REFERENCES dbo.T_RACK_INVENTORY (RackInventoryID),
        CONSTRAINT CK_RACK_TRANSACTION_DETAIL_QTY CHECK (Qty > 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_TRANSACTION_DETAIL_HEADER' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION_DETAIL'))
    CREATE INDEX IX_RACK_TRANSACTION_DETAIL_HEADER ON dbo.T_RACK_TRANSACTION_DETAIL(RackTransactionID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_TRANSACTION_DETAIL_ITEMCODE' AND object_id = OBJECT_ID('dbo.T_RACK_TRANSACTION_DETAIL'))
    CREATE INDEX IX_RACK_TRANSACTION_DETAIL_ITEMCODE ON dbo.T_RACK_TRANSACTION_DETAIL(ItemCode);
GO

IF OBJECT_ID('dbo.T_RACK_ITEM_TAG', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_RACK_ITEM_TAG
    (
        ItemCode           NVARCHAR(100)  NOT NULL,
        GRNNo              NVARCHAR(100)  NOT NULL,
        UniqueNumber       NVARCHAR(100)  NOT NULL,
        Status             NVARCHAR(20)   NOT NULL, -- STORED | PICKED
        LocationID         INT            NOT NULL, -- rack it is stored in / was last picked from
        LocationCode       NVARCHAR(150)  NOT NULL,
        Qty                DECIMAL(18,3)  NOT NULL,
        LastTransactionID  BIGINT         NOT NULL,
        UpdatedBy          NVARCHAR(100)  NOT NULL,
        UpdatedAt          DATETIME       NOT NULL CONSTRAINT DF_RACK_ITEM_TAG_UPDATEDAT DEFAULT GETDATE(),

        CONSTRAINT PK_RACK_ITEM_TAG PRIMARY KEY (ItemCode, GRNNo, UniqueNumber),
        CONSTRAINT FK_RACK_ITEM_TAG_LOCATION FOREIGN KEY (LocationID)
            REFERENCES dbo.T_LOCATION (LocationID),
        CONSTRAINT CK_RACK_ITEM_TAG_STATUS CHECK (Status IN ('STORED', 'PICKED'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RACK_ITEM_TAG_LOCATION' AND object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG'))
    CREATE INDEX IX_RACK_ITEM_TAG_LOCATION ON dbo.T_RACK_ITEM_TAG(LocationID, Status);
GO
