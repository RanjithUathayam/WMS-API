/*
    Pick List (Stock Transfer Request based picking) — schema objects
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).
    Run AFTER sql/Inventory_Schema.sql, sql/PalletMapping_Schema.sql and sql/Picking_Schema.sql.

    Existing objects reused (NOT recreated here):
      - [BBLive].[dbo].OWTQ / WTQ1 / OWHS (SAP Business One, read-only, cross-database)
            -> Source Stock Transfer Requests. Only open lines (WTQ1.LineStatus = 'O') are eligible.
      - [dbo].[T_INVENTORY]  (sql/Inventory_Schema.sql)
            -> The only stock ledger. Pick List picking deducts T_INVENTORY.Quantity exactly the way
               the existing Complete Picking does (repository/inventoryRepository.js: deductInventoryQty),
               so every other report/screen keeps seeing one consistent stock figure.
      - [dbo].[T_PALLET_MAPPING] / [dbo].[T_PALLET_MAPPING_BOX]  (sql/PalletMapping_Schema.sql)
            -> Pallet / box identity. T_PICK_TRANSACTION.BoxID = T_PALLET_MAPPING_BOX.PalletMappingBoxID.
      - [dbo].[T_PICKING_HISTORY]  (sql/Picking_Schema.sql)
            -> Every Pick List pick ALSO writes one T_PICKING_HISTORY row (linked from
               T_PICK_TRANSACTION.PickingHistoryID) so the existing Picking History report stays complete.

    New objects (this process only):
      - T_PICK_LIST                — header, one per generated Pick List
      - T_PICK_LIST_DETAIL         — one row per source STR line (DocEntry/DocNum/LineNum preserved)
      - T_PICK_TRANSACTION         — one row per physical pick (warehouse/location/pallet/box/qty)
      - T_DC / T_DC_DETAIL         — Delivery Challan generated from a completed Pick List
      - T_PICK_LIST_PROCESS_LOG    — audit trail of every completion stage (DC, SAP) incl. failures

    Pick List status lifecycle (T_PICK_LIST.Status):
        OPEN -> IN_PROGRESS -> PICKED -> DC_CREATED -> COMPLETED
        OPEN -> CANCELLED (reserved for a future cancel feature; excluded from reservations)
      PICKED     = every detail fully picked and validated by the Complete API (CompletedBy/Date set).
      DC_CREATED = DC exists, SAP Stock Transfer not yet posted (failed or pending retry).
      COMPLETED  = DC + SAP Stock Transfer both stored.

    Idempotency / duplicate prevention:
      - UX_DC_PICKLIST: one DC per Pick List, enforced by the database.
      - UX_PICK_LIST_SAP_ST: one SAP Stock Transfer DocEntry per Pick List.
      - ProcessingToken/ProcessingStartedAt: a short lease so two concurrent Complete calls can never
        both reach SAP. SAP StockTransfers.Reference2 carries PickListNumber, and the service looks it
        up in SAP before every POST, so a retry after a lost response never posts a second transfer.
      - Pick List creation is serialized with sp_getapplock and reserves each STR line's quantity
        (see repository/pickingRepository.js: getReservedQtyBySourceLines).
*/

IF OBJECT_ID('dbo.T_PICK_LIST', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PICK_LIST
    (
        PickListID              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        -- PL000001 ... PL999999, then PL1000000 — derived from the identity, therefore always unique.
        PickListNumber          AS (CAST('PL' + CASE WHEN PickListID < 1000000
                                        THEN RIGHT('000000' + CAST(PickListID AS VARCHAR(10)), 6)
                                        ELSE CAST(PickListID AS VARCHAR(10)) END AS VARCHAR(20))) PERSISTED,
        Status                  NVARCHAR(20)   NOT NULL DEFAULT 'OPEN', -- OPEN | IN_PROGRESS | PICKED | DC_CREATED | COMPLETED | CANCELLED
        FromWarehouse           NVARCHAR(50)   NOT NULL,
        ToWarehouse             NVARCHAR(50)   NOT NULL,
        TotalRequestedQty       DECIMAL(18,3)  NOT NULL DEFAULT 0,
        TotalPickedQty          DECIMAL(18,3)  NOT NULL DEFAULT 0,
        CreatedBy               NVARCHAR(100)  NOT NULL,
        CreatedDate             DATETIME       NOT NULL DEFAULT GETDATE(),
        CompletedBy             NVARCHAR(100)  NULL,  -- who validated picking as complete
        CompletedDate           DATETIME       NULL,  -- drives SAP DocDate/TaxDate and DC date
        DCID                    INT            NULL,
        DCNumber                NVARCHAR(20)   NULL,
        StockTransferDocEntry   INT            NULL,
        StockTransferDocNum     INT            NULL,
        StockTransferNumber     NVARCHAR(20)   NULL,  -- display value of the SAP DocNum
        SapBaseLinked           BIT            NULL,  -- 1 = SAP lines posted with BaseType/BaseEntry/BaseLine (closes the STR lines in SAP)
        StockTransferPostedDate DATETIME       NULL,
        ProcessingToken         UNIQUEIDENTIFIER NULL,
        ProcessingStartedAt     DATETIME       NULL,
        LastErrorStage          NVARCHAR(20)   NULL,  -- VALIDATION | DC | SAP
        LastErrorMessage        NVARCHAR(2000) NULL,
        LastErrorDate           DATETIME       NULL,
        RetryCount              INT            NOT NULL DEFAULT 0,
        UpdatedBy               NVARCHAR(100)  NULL,
        UpdatedDate             DATETIME       NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PICK_LIST_NUMBER' AND object_id = OBJECT_ID('dbo.T_PICK_LIST'))
    CREATE UNIQUE INDEX UX_PICK_LIST_NUMBER ON dbo.T_PICK_LIST(PickListNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PICK_LIST_SAP_ST' AND object_id = OBJECT_ID('dbo.T_PICK_LIST'))
    CREATE UNIQUE INDEX UX_PICK_LIST_SAP_ST ON dbo.T_PICK_LIST(StockTransferDocEntry) WHERE StockTransferDocEntry IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_LIST_STATUS' AND object_id = OBJECT_ID('dbo.T_PICK_LIST'))
    CREATE INDEX IX_PICK_LIST_STATUS ON dbo.T_PICK_LIST(Status, CreatedDate);
GO

IF OBJECT_ID('dbo.T_PICK_LIST_DETAIL', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PICK_LIST_DETAIL
    (
        PickListDetailID  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PickListID        INT            NOT NULL,
        SourceDocEntry    INT            NOT NULL,  -- OWTQ.DocEntry
        SourceDocNum      INT            NOT NULL,  -- OWTQ.DocNum
        SourceLineNum     INT            NOT NULL,  -- WTQ1.LineNum
        SourceDocDate     DATE           NULL,
        SourceDocDueDate  DATE           NULL,
        ItemCode          NVARCHAR(100)  NOT NULL,
        ItemName          NVARCHAR(200)  NULL,
        SourceOpenQty     DECIMAL(18,3)  NOT NULL,  -- WTQ1.OpenQty at generation time (audit)
        RequestedQty      DECIMAL(18,3)  NOT NULL,  -- quantity this Pick List must pick for the line
        PickedQty         DECIMAL(18,3)  NOT NULL DEFAULT 0,
        RemainingQty      DECIMAL(18,3)  NOT NULL,
        FromWarehouse     NVARCHAR(50)   NOT NULL,
        ToWarehouse       NVARCHAR(50)   NOT NULL,
        Status            NVARCHAR(20)   NOT NULL DEFAULT 'OPEN', -- OPEN | PARTIAL | PICKED

        CONSTRAINT FK_PICK_LIST_DETAIL_HEADER FOREIGN KEY (PickListID) REFERENCES dbo.T_PICK_LIST (PickListID),
        CONSTRAINT CK_PICK_LIST_DETAIL_QTY CHECK (PickedQty >= 0 AND RemainingQty >= 0 AND PickedQty + RemainingQty = RequestedQty)
    );
END
GO

-- A source STR line appears at most once per Pick List.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PICK_LIST_DETAIL_SOURCE' AND object_id = OBJECT_ID('dbo.T_PICK_LIST_DETAIL'))
    CREATE UNIQUE INDEX UX_PICK_LIST_DETAIL_SOURCE ON dbo.T_PICK_LIST_DETAIL(PickListID, SourceDocEntry, SourceLineNum);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_LIST_DETAIL_SOURCELINE' AND object_id = OBJECT_ID('dbo.T_PICK_LIST_DETAIL'))
    CREATE INDEX IX_PICK_LIST_DETAIL_SOURCELINE ON dbo.T_PICK_LIST_DETAIL(SourceDocEntry, SourceLineNum) INCLUDE (RequestedQty, PickListID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_LIST_DETAIL_ITEM' AND object_id = OBJECT_ID('dbo.T_PICK_LIST_DETAIL'))
    CREATE INDEX IX_PICK_LIST_DETAIL_ITEM ON dbo.T_PICK_LIST_DETAIL(PickListID, ItemCode);
GO

IF OBJECT_ID('dbo.T_PICK_TRANSACTION', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PICK_TRANSACTION
    (
        PickTransactionID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PickListID        INT            NOT NULL,
        PickListDetailID  INT            NOT NULL,
        SourceDocEntry    INT            NOT NULL,  -- copied from the detail so every pick is self-describing
        SourceDocNum      INT            NOT NULL,
        SourceLineNum     INT            NOT NULL,
        ItemCode          NVARCHAR(100)  NOT NULL,
        Warehouse         NVARCHAR(50)   NOT NULL,
        LocationID        INT            NULL,
        Location          NVARCHAR(150)  NULL,
        InventoryID       BIGINT         NOT NULL,
        PalletMappingID   INT            NOT NULL,
        PalletNumber      NVARCHAR(100)  NOT NULL,
        BoxID             BIGINT         NULL,      -- T_PALLET_MAPPING_BOX.PalletMappingBoxID
        BoxNumber         NVARCHAR(100)  NOT NULL,
        AvailableQty      DECIMAL(18,3)  NOT NULL,  -- server-side available qty at pick time (before deduction)
        PickQty           DECIMAL(18,3)  NOT NULL,
        PickingHistoryID  BIGINT         NULL,      -- T_PICKING_HISTORY row written in the same transaction
        ClientRequestId   NVARCHAR(100)  NULL,      -- optional idempotency key from the HHT (double-tap protection)
        CreatedBy         NVARCHAR(100)  NOT NULL,
        CreatedDate       DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_PICK_TRANSACTION_HEADER FOREIGN KEY (PickListID) REFERENCES dbo.T_PICK_LIST (PickListID),
        CONSTRAINT FK_PICK_TRANSACTION_DETAIL FOREIGN KEY (PickListDetailID) REFERENCES dbo.T_PICK_LIST_DETAIL (PickListDetailID),
        CONSTRAINT FK_PICK_TRANSACTION_INVENTORY FOREIGN KEY (InventoryID) REFERENCES dbo.T_INVENTORY (InventoryID),
        CONSTRAINT FK_PICK_TRANSACTION_PALLET FOREIGN KEY (PalletMappingID) REFERENCES dbo.T_PALLET_MAPPING (PalletMappingID),
        CONSTRAINT CK_PICK_TRANSACTION_QTY CHECK (PickQty > 0 AND PickQty <= AvailableQty)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_TRANSACTION_PICKLIST' AND object_id = OBJECT_ID('dbo.T_PICK_TRANSACTION'))
    CREATE INDEX IX_PICK_TRANSACTION_PICKLIST ON dbo.T_PICK_TRANSACTION(PickListID, PickListDetailID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_TRANSACTION_PALLET' AND object_id = OBJECT_ID('dbo.T_PICK_TRANSACTION'))
    CREATE INDEX IX_PICK_TRANSACTION_PALLET ON dbo.T_PICK_TRANSACTION(PalletNumber, BoxNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PICK_TRANSACTION_CLIENTREQ' AND object_id = OBJECT_ID('dbo.T_PICK_TRANSACTION'))
    CREATE UNIQUE INDEX UX_PICK_TRANSACTION_CLIENTREQ ON dbo.T_PICK_TRANSACTION(PickListID, ClientRequestId) WHERE ClientRequestId IS NOT NULL;
GO

IF OBJECT_ID('dbo.T_DC', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_DC
    (
        DCID          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DCNumber      AS (CAST('DC' + CASE WHEN DCID < 1000000
                              THEN RIGHT('000000' + CAST(DCID AS VARCHAR(10)), 6)
                              ELSE CAST(DCID AS VARCHAR(10)) END AS VARCHAR(20))) PERSISTED,
        PickListID    INT            NOT NULL,
        DCDate        DATE           NOT NULL,
        FromWarehouse NVARCHAR(50)   NOT NULL,
        ToWarehouse   NVARCHAR(50)   NOT NULL,
        TotalQty      DECIMAL(18,3)  NOT NULL,
        Status        NVARCHAR(20)   NOT NULL DEFAULT 'CREATED', -- CREATED
        CreatedBy     NVARCHAR(100)  NOT NULL,
        CreatedDate   DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_DC_PICKLIST FOREIGN KEY (PickListID) REFERENCES dbo.T_PICK_LIST (PickListID)
    );
END
GO

-- The hard guarantee behind "never two DCs for the same Pick List".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_DC_PICKLIST' AND object_id = OBJECT_ID('dbo.T_DC'))
    CREATE UNIQUE INDEX UX_DC_PICKLIST ON dbo.T_DC(PickListID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_DC_NUMBER' AND object_id = OBJECT_ID('dbo.T_DC'))
    CREATE UNIQUE INDEX UX_DC_NUMBER ON dbo.T_DC(DCNumber);
GO

IF OBJECT_ID('dbo.T_DC_DETAIL', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_DC_DETAIL
    (
        DCDetailID       INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DCID             INT            NOT NULL,
        PickListDetailID INT            NOT NULL,
        SourceDocEntry   INT            NOT NULL,
        SourceDocNum     INT            NOT NULL,
        SourceLineNum    INT            NOT NULL,
        ItemCode         NVARCHAR(100)  NOT NULL,
        ItemName         NVARCHAR(200)  NULL,
        Quantity         DECIMAL(18,3)  NOT NULL,
        FromWarehouse    NVARCHAR(50)   NOT NULL,
        ToWarehouse      NVARCHAR(50)   NOT NULL,

        CONSTRAINT FK_DC_DETAIL_HEADER FOREIGN KEY (DCID) REFERENCES dbo.T_DC (DCID),
        CONSTRAINT FK_DC_DETAIL_PICKLIST_DETAIL FOREIGN KEY (PickListDetailID) REFERENCES dbo.T_PICK_LIST_DETAIL (PickListDetailID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_DC_DETAIL_PICKLIST_DETAIL' AND object_id = OBJECT_ID('dbo.T_DC_DETAIL'))
    CREATE UNIQUE INDEX UX_DC_DETAIL_PICKLIST_DETAIL ON dbo.T_DC_DETAIL(PickListDetailID);
GO

IF OBJECT_ID('dbo.T_PICK_LIST_PROCESS_LOG', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_PICK_LIST_PROCESS_LOG
    (
        ProcessLogID  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PickListID    INT            NOT NULL,
        Stage         NVARCHAR(20)   NOT NULL, -- VALIDATION | DC | SAP
        Result        NVARCHAR(20)   NOT NULL, -- SUCCESS | FAILED | SKIPPED
        Message       NVARCHAR(2000) NULL,
        RequestBody   NVARCHAR(MAX)  NULL,     -- SAP payload (never credentials / cookies)
        ResponseBody  NVARCHAR(MAX)  NULL,
        CreatedBy     NVARCHAR(100)  NULL,
        CreatedDate   DATETIME       NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_PICK_LIST_PROCESS_LOG_HEADER FOREIGN KEY (PickListID) REFERENCES dbo.T_PICK_LIST (PickListID)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PICK_LIST_PROCESS_LOG_PICKLIST' AND object_id = OBJECT_ID('dbo.T_PICK_LIST_PROCESS_LOG'))
    CREATE INDEX IX_PICK_LIST_PROCESS_LOG_PICKLIST ON dbo.T_PICK_LIST_PROCESS_LOG(PickListID, CreatedDate);
GO
