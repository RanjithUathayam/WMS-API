/*
    Pick List — FULL BOX PICKING migration
    Database: [WMS_NEW].[dbo]

    Review before running. Nothing here is executed automatically by the application.
    Safe to run multiple times (every statement is guarded).
    Run AFTER sql/PickList_Schema.sql, and BEFORE deploying the API build with Full Box Picking —
    that build writes PlannedQty / IsFullBox and records picked quantities above the required quantity,
    which the original CK_PICK_LIST_DETAIL_QTY rejects.

    What changes and why:
      1. T_PICK_LIST_DETAIL.PlannedQty
            Quantity planned at Pick List generation from whole boxes in stock: required 10, smallest
            covering box 25 -> PlannedQty 25. NULL on Pick Lists generated before this migration.
      2. CK_PICK_LIST_DETAIL_QTY  ->  CK_PICK_LIST_DETAIL_QTY_FULLBOX
            Full boxes are always picked whole, so PickedQty may now EXCEED RequestedQty (the excess).
            RemainingQty = max(RequestedQty - PickedQty, 0), never negative. Every existing row already
            satisfies the new rule (old rule: PickedQty + RemainingQty = RequestedQty, RemainingQty >= 0).
            The excess is not stored; it is always PickedQty - RequestedQty when positive.
      3. T_PICK_TRANSACTION.IsFullBox
            1 for picks made by Full Box Picking (AvailableQty = the full box quantity of the item,
            PickQty = the part of it assigned to that source line). 0 for older, quantity-based picks.
      4. UX_PICK_TRANSACTION_FULLBOX
            Database-level guarantee that a box line (InventoryID) is booked to a Pick List line at most
            once by Full Box Picking — no duplicate box picking even if the application check were bypassed.

    Unchanged on purpose:
      - Reservation of STR quantity (getReservedQtyBySourceLines) stays on RequestedQty: the excess of a
        full box is not part of the Stock Transfer Request.
      - T_DC / T_DC_DETAIL: DC quantity was already the picked quantity; it now simply includes the excess.
*/

-- 1. Planned (full box) quantity per line
IF COL_LENGTH('dbo.T_PICK_LIST_DETAIL', 'PlannedQty') IS NULL
    ALTER TABLE dbo.T_PICK_LIST_DETAIL ADD PlannedQty DECIMAL(18,3) NULL;
GO

-- 2. Allow PickedQty > RequestedQty (full box excess)
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_PICK_LIST_DETAIL_QTY' AND parent_object_id = OBJECT_ID('dbo.T_PICK_LIST_DETAIL'))
    ALTER TABLE dbo.T_PICK_LIST_DETAIL DROP CONSTRAINT CK_PICK_LIST_DETAIL_QTY;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = 'CK_PICK_LIST_DETAIL_QTY_FULLBOX' AND parent_object_id = OBJECT_ID('dbo.T_PICK_LIST_DETAIL'))
    ALTER TABLE dbo.T_PICK_LIST_DETAIL WITH CHECK ADD CONSTRAINT CK_PICK_LIST_DETAIL_QTY_FULLBOX
        CHECK (PickedQty >= 0
               AND RemainingQty >= 0
               AND RemainingQty = CASE WHEN RequestedQty > PickedQty THEN RequestedQty - PickedQty ELSE 0 END);
GO

-- 3. Full box flag on pick transactions
IF COL_LENGTH('dbo.T_PICK_TRANSACTION', 'IsFullBox') IS NULL
    ALTER TABLE dbo.T_PICK_TRANSACTION ADD IsFullBox BIT NOT NULL
        CONSTRAINT DF_PICK_TRANSACTION_ISFULLBOX DEFAULT 0;
GO

-- 4. A box line is booked to a Pick List line at most once
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PICK_TRANSACTION_FULLBOX' AND object_id = OBJECT_ID('dbo.T_PICK_TRANSACTION'))
    CREATE UNIQUE INDEX UX_PICK_TRANSACTION_FULLBOX
        ON dbo.T_PICK_TRANSACTION(InventoryID, PickListDetailID)
        WHERE IsFullBox = 1;
GO
