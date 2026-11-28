/*
    Rack Management — a labelled piece is identified by (ItemType, GRNNo, UniqueNumber).
    Database: [WMS_NEW].[dbo]

    GRN numbers come from separate series per label type (PO GRN vs ST transfer), so the same GRNNo can
    exist for both types. The label identity used for "already stored / already picked / not in this
    rack" validation is therefore ItemType + GRNNo + UniqueNumber (from the item QR:
    ITEMCODE|TYPE|GRN NO|ITEMGROUP|UNIQUE NUMBER|QTY). ItemCode stays on the row as data.

    Steps (guarded, safe to run more than once):
      1. Add T_RACK_ITEM_TAG.ItemType and backfill it from the transaction line that last moved the tag.
      2. Make it NOT NULL and re-key the table: PK (ItemType, GRNNo, UniqueNumber).

    Run this BEFORE deploying the API build with the ItemType-based tag validation.
*/

IF COL_LENGTH('dbo.T_RACK_ITEM_TAG', 'ItemType') IS NULL
    ALTER TABLE dbo.T_RACK_ITEM_TAG ADD ItemType NVARCHAR(50) NULL;
GO

UPDATE t
SET t.ItemType = d.ItemType
FROM dbo.T_RACK_ITEM_TAG t
CROSS APPLY (
    SELECT TOP 1 x.ItemType
    FROM dbo.T_RACK_TRANSACTION_DETAIL x
    WHERE x.RackTransactionID = t.LastTransactionID
      AND x.ItemCode = t.ItemCode AND x.GRNNo = t.GRNNo AND x.UniqueNumber = t.UniqueNumber
      AND x.ItemType IS NOT NULL
) d
WHERE t.ItemType IS NULL;
GO

-- Stop here if any tag could not be backfilled (would violate NOT NULL) or if the new key is not unique.
IF EXISTS (SELECT 1 FROM dbo.T_RACK_ITEM_TAG WHERE ItemType IS NULL)
    THROW 50001, 'T_RACK_ITEM_TAG has rows without ItemType; fix them before continuing.', 1;
IF EXISTS (SELECT 1 FROM dbo.T_RACK_ITEM_TAG GROUP BY ItemType, GRNNo, UniqueNumber HAVING COUNT(*) > 1)
    THROW 50002, 'T_RACK_ITEM_TAG has duplicate (ItemType, GRNNo, UniqueNumber); resolve them before continuing.', 1;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG') AND name = 'ItemType' AND is_nullable = 1)
    ALTER TABLE dbo.T_RACK_ITEM_TAG ALTER COLUMN ItemType NVARCHAR(50) NOT NULL;
GO

-- Re-key: drop the old (ItemCode, GRNNo, UniqueNumber) PK, create (ItemType, GRNNo, UniqueNumber).
IF EXISTS (
    SELECT 1 FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG') AND i.name = 'PK_RACK_ITEM_TAG' AND c.name = 'ItemCode'
)
    ALTER TABLE dbo.T_RACK_ITEM_TAG DROP CONSTRAINT PK_RACK_ITEM_TAG;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.T_RACK_ITEM_TAG') AND name = 'PK_RACK_ITEM_TAG')
    ALTER TABLE dbo.T_RACK_ITEM_TAG ADD CONSTRAINT PK_RACK_ITEM_TAG PRIMARY KEY (ItemType, GRNNo, UniqueNumber);
GO
