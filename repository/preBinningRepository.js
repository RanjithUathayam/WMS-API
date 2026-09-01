const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

// SAP Business One item groups excluded from warehouse-stock results (U_SubGrp1 on OITM).
const EXCLUDED_ITEM_SUBGROUPS = [
    'ACCESSORIES',
    'ADVERTISEMENT',
    'ALL',
    'SAMPLE',
    'PRINTING & STATIONERY',
    'IMPERIAL COMPUTERS',
    'PACKING MATERIAL',
    'REPAIRS & MAINTENANCE',
    'SALES PROMOTION EXPENSES',
    'EVERYDAY DHOTIE',
    'ALLDAYS DHOTIE',
    'ADD DHOTIE',
    'ADD SHIRT',
    'EVERYDAY SHIRTING',
    'EVERYDAY RDY'
];

/**
 * Warehouses eligible for Pre-Binning: SAP Business One (OITW/OITM/OWHS, cross-database via
 * [BBLive]) warehouses at the THINDAL site that currently carry eligible stock.
 */
async function getPreBinningWarehouses() {
    return sequelize.query(`
        SELECT DISTINCT
            t0.WhsCode AS whsCode,
            t2.WhsName AS whsName
        FROM [BBLive].[dbo].OITW t0
        LEFT JOIN [BBLive].[dbo].OITM t1 ON t0.ItemCode = t1.ItemCode
        LEFT JOIN [BBLive].[dbo].OWHS t2 ON t0.WhsCode = t2.WhsCode
        WHERE
            t2.WhsName LIKE '%THINDAL%'
            AND t0.OnHand > 0
            AND t1.ValidFor = 'Y'
            AND (t1.U_SubGrp1 IS NULL OR t1.U_SubGrp1 NOT IN (:excludedGroups))
        ORDER BY t2.WhsName
    `, {
        replacements: { excludedGroups: EXCLUDED_ITEM_SUBGROUPS },
        type: QueryTypes.SELECT
    });
}

/** True only if whsCode is one of the warehouses GetPreBinningWarehousesAsync would return. */
async function isWarehouseAllowed(transaction, whsCode) {
    const rows = await sequelize.query(`
        SELECT TOP 1 1 AS found
        FROM [BBLive].[dbo].OITW t0
        LEFT JOIN [BBLive].[dbo].OITM t1 ON t0.ItemCode = t1.ItemCode
        LEFT JOIN [BBLive].[dbo].OWHS t2 ON t0.WhsCode = t2.WhsCode
        WHERE
            t0.WhsCode = :whsCode
            AND t2.WhsName LIKE '%THINDAL%'
            AND t0.OnHand > 0
            AND t1.ValidFor = 'Y'
            AND (t1.U_SubGrp1 IS NULL OR t1.U_SubGrp1 NOT IN (:excludedGroups))
    `, {
        replacements: { whsCode, excludedGroups: EXCLUDED_ITEM_SUBGROUPS },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows.length > 0;
}

/** Live on-hand stock for one warehouse — never called without whsCode. */
async function getWarehouseStock(whsCode) {
    return sequelize.query(`
        SELECT
            t0.ItemCode                       AS itemCode,
            CAST(t0.OnHand AS DECIMAL(18,3))  AS availableQty,
            t1.ItemName                       AS itemName,
            t1.U_SubGrp3                      AS itemGroup,
            t0.WhsCode                        AS warehouseCode,
            t2.WhsName                        AS warehouseName
        FROM [BBLive].[dbo].OITW t0
        LEFT JOIN [BBLive].[dbo].OITM t1 ON t0.ItemCode = t1.ItemCode
        LEFT JOIN [BBLive].[dbo].OWHS t2 ON t0.WhsCode = t2.WhsCode
        WHERE
            t0.WhsCode = :whsCode
            AND t0.OnHand > 0
            AND t1.ValidFor = 'Y'
            AND (t1.U_SubGrp1 IS NULL OR t1.U_SubGrp1 NOT IN (:excludedGroups))
        ORDER BY t0.ItemCode
    `, {
        replacements: { whsCode, excludedGroups: EXCLUDED_ITEM_SUBGROUPS },
        type: QueryTypes.SELECT
    });
}

/**
 * Lightweight, non-locking lookup for the /box/validate advisory endpoint — system-wide by
 * BoxNumber. A box number is single-use: once completed it can never be reopened, so the most
 * recent row (open or completed) always reflects the number's current, permanent state.
 */
async function findLatestBoxByNumber(boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, TotalQty, Status
        FROM T_PREBIN_BOX WITH (NOLOCK)
        WHERE BoxNumber = :boxNumber
        ORDER BY CASE WHEN Status = 'IN_PROGRESS' THEN 0 ELSE 1 END, CreatedAt DESC
    `, {
        replacements: { boxNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Locks the most recent box row for this BoxNumber, regardless of warehouse — lets the caller
 * detect "already completed" (permanently blocked) and "active in a different warehouse"
 * (UX_PREBIN_BOX_OPEN guarantees at most one open box per number system-wide) in one lookup.
 */
async function lockLatestBoxByNumber(transaction, boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, TotalQty, Status
        FROM T_PREBIN_BOX WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE BoxNumber = :boxNumber
        ORDER BY CASE WHEN Status = 'IN_PROGRESS' THEN 0 ELSE 1 END, CreatedAt DESC
    `, {
        replacements: { boxNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Locks the live SAP stock row for this exact warehouse + item (OITW joined to OITM for the
 * eligibility filters). Deliberately does NOT filter OnHand > 0 — a zero/short row is still a
 * valid, scannable item (see scanItemAsync: warehouse qty is display/reference only and never
 * blocks a scan); only a genuinely missing/ineligible row is ITEM_NOT_AVAILABLE.
 */
async function lockWarehouseItemStock(transaction, whsCode, itemCode) {
    const rows = await sequelize.query(`
        SELECT TOP 1
            t0.WhsCode, t0.ItemCode, CAST(t0.OnHand AS DECIMAL(18,3)) AS OnHand,
            t1.ItemName, t1.U_SubGrp3 AS ItemGroup
        FROM [BBLive].[dbo].OITW t0 WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        LEFT JOIN [BBLive].[dbo].OITM t1 ON t0.ItemCode = t1.ItemCode
        WHERE
            t0.WhsCode = :whsCode AND t0.ItemCode = :itemCode
            AND t1.ValidFor = 'Y'
            AND (t1.U_SubGrp1 IS NULL OR t1.U_SubGrp1 NOT IN (:excludedGroups))
    `, {
        replacements: { whsCode, itemCode, excludedGroups: EXCLUDED_ITEM_SUBGROUPS },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * T_PREBIN_ITEM no longer stores GRNNo (it's not part of the scan identity and isn't validated
 * during Item Scan), so at box completion the GRNNo required by T_BIN_COMPLETE (NOT NULL) is
 * resolved here instead — the most relevant ERP_Pre_Binning row for this ItemCode + ItemGroup.
 * Ambiguous if an item legitimately spans multiple open GRNs; picks the non-completed, oldest one.
 */
async function findGrnForItem(transaction, itemCode, itemGroup) {
    const rows = await sequelize.query(`
        SELECT TOP 1 GRNNo, ItemCode, ItemGroup, Type, DocNo
        FROM ERP_Pre_Binning WITH (NOLOCK)
        WHERE ItemCode = :itemCode AND ItemGroup = :itemGroup
          AND (isDelete = 0 OR isDelete IS NULL)
        ORDER BY CASE WHEN GRNStatus = 'Completed' THEN 1 ELSE 0 END, CreatedDate ASC
    `, {
        replacements: { itemCode, itemGroup },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Unique Number only has to be unique within its ItemCode + GRNNo, not globally across all items
 *  or GRNs — the same number legitimately recurs for the same ItemCode under a different GRN. */
async function uniqueNumberExists(transaction, itemCode, grnNo, uniqueNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 1 AS found
        FROM T_PREBIN_ITEM WITH (UPDLOCK, HOLDLOCK)
        WHERE ItemCode = :itemCode AND GRNNo = :grnNo AND UniqueNumber = :uniqueNumber
    `, {
        replacements: { itemCode, grnNo, uniqueNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows.length > 0;
}

async function createBox(transaction, { boxNumber, warehouseCode, itemGroup, createdBy }) {
    const rows = await sequelize.query(`
        INSERT INTO T_PREBIN_BOX (BoxNumber, WarehouseCode, ItemGroup, TotalQty, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.PreBinBoxID, INSERTED.BoxNumber, INSERTED.WarehouseCode, INSERTED.ItemGroup,
               INSERTED.TotalQty, INSERTED.Status
        VALUES (:boxNumber, :warehouseCode, :itemGroup, 0, 'IN_PROGRESS', :createdBy, GETDATE())
    `, {
        replacements: { boxNumber, warehouseCode, itemGroup, createdBy },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function setBoxItemGroup(transaction, preBinBoxID, itemGroup) {
    await sequelize.query(`
        UPDATE T_PREBIN_BOX SET ItemGroup = :itemGroup
        WHERE PreBinBoxID = :preBinBoxID AND ItemGroup IS NULL
    `, {
        replacements: { itemGroup, preBinBoxID },
        transaction,
        type: QueryTypes.UPDATE
    });
}

async function insertScannedItem(transaction, item) {
    try {
        await sequelize.query(`
            INSERT INTO T_PREBIN_ITEM (PreBinBoxID, WarehouseCode, ItemCode, Type, GRNNo, ItemGroup, UniqueNumber, Qty, ScannedBy, ScannedAt)
            VALUES (:preBinBoxID, :warehouseCode, :itemCode, :type, :grnNo, :itemGroup, :uniqueNumber, :qty, :scannedBy, GETDATE())
        `, {
            replacements: {
                preBinBoxID: item.preBinBoxID,
                warehouseCode: item.warehouseCode,
                itemCode: item.itemCode,
                type: item.type,
                grnNo: item.grnNo,
                itemGroup: item.itemGroup,
                uniqueNumber: item.uniqueNumber,
                qty: item.qty,
                scannedBy: item.scannedBy
            },
            transaction,
            type: QueryTypes.INSERT
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`Unique Number ${item.uniqueNumber} for item ${item.itemCode} in GRN ${item.grnNo} has already been scanned.`);
            duplicateError.code = 'DUPLICATE_ITEM_UNIQUE_NUMBER';
            throw duplicateError;
        }
        throw error;
    }
}

async function incrementBoxTotalQty(transaction, preBinBoxID, qty) {
    await sequelize.query(`
        UPDATE T_PREBIN_BOX SET TotalQty = TotalQty + :qty WHERE PreBinBoxID = :preBinBoxID
    `, {
        replacements: { qty, preBinBoxID },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/**
 * whsCode is optional here — a box number is already globally unique while IN_PROGRESS
 * (UX_PREBIN_BOX_OPEN), so this is a valid lookup by BoxNumber alone. When whsCode IS supplied it
 * is still enforced as a cross-check, not silently ignored.
 */
async function getBoxWithItems(whsCode, boxNumber) {
    const boxes = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, CAST(TotalQty AS DECIMAL(18,3)) AS TotalQty, Status
        FROM T_PREBIN_BOX WITH (NOLOCK)
        WHERE BoxNumber = :boxNumber AND (:whsCode IS NULL OR WarehouseCode = :whsCode)
        ORDER BY CASE WHEN Status = 'IN_PROGRESS' THEN 0 ELSE 1 END, CreatedAt DESC
    `, {
        replacements: { boxNumber, whsCode: whsCode || null },
        type: QueryTypes.SELECT
    });

    const box = boxes[0];
    if (!box) return null;

    // Summary view for the UI: grouped by ItemCode + Type only. UniqueNumber stays in T_PREBIN_ITEM
    // untouched for audit/traceability — see getBoxItemsGroupedForCompletion for the per-item
    // breakdown used at box completion.
    const items = await sequelize.query(`
        SELECT ItemCode, Type, CAST(SUM(Qty) AS DECIMAL(18,3)) AS Qty
        FROM T_PREBIN_ITEM WITH (NOLOCK)
        WHERE PreBinBoxID = :preBinBoxID
        GROUP BY ItemCode, Type
        ORDER BY ItemCode, Type
    `, {
        replacements: { preBinBoxID: box.PreBinBoxID },
        type: QueryTypes.SELECT
    });

    return { box, items };
}

/** Locks the box row for completion, scoped to the given warehouse. */
async function lockBoxForCompletion(transaction, whsCode, boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, TotalQty, Status
        FROM T_PREBIN_BOX WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE BoxNumber = :boxNumber AND WarehouseCode = :whsCode
    `, {
        replacements: { boxNumber, whsCode },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function getItemCountForBox(transaction, preBinBoxID) {
    const rows = await sequelize.query(`
        SELECT COUNT(1) AS cnt FROM T_PREBIN_ITEM WITH (UPDLOCK, HOLDLOCK) WHERE PreBinBoxID = :preBinBoxID
    `, {
        replacements: { preBinBoxID },
        transaction,
        type: QueryTypes.SELECT
    });
    return Number(rows[0].cnt);
}

/**
 * One row per ItemCode/ItemGroup in the box, with the scanned unique numbers grouped in.
 * Grouped by ItemCode + ItemGroup ONLY (not Type) — T_BIN_COMPLETE's real primary key is
 * (BinID, GRNNo, ItemCode), and findGrnForItem resolves the same GRNNo for a given
 * ItemCode + ItemGroup regardless of Type. Grouping by Type as well would emit two INSERTs
 * with the same (BinID, GRNNo, ItemCode) whenever an item is scanned under two Types in the
 * same box, violating that primary key.
 */
async function getBoxItemsGroupedForCompletion(transaction, preBinBoxID) {
    return sequelize.query(`
        SELECT
            i.ItemCode, i.ItemGroup,
            MAX(i.Type) AS Type,
            CAST(SUM(i.Qty) AS DECIMAL(18,3)) AS Qty,
            STRING_AGG(CONVERT(NVARCHAR(MAX), i.UniqueNumber), ',') AS UniqueNumbers
        FROM T_PREBIN_ITEM i WITH (UPDLOCK, HOLDLOCK)
        WHERE i.PreBinBoxID = :preBinBoxID
        GROUP BY i.ItemCode, i.ItemGroup
    `, {
        replacements: { preBinBoxID },
        transaction,
        type: QueryTypes.SELECT
    });
}

async function getItemNamesByCode(transaction, itemCodes) {
    if (!itemCodes.length) return {};
    const rows = await sequelize.query(`
        SELECT ItemCode, ItemName FROM [BBLive].[dbo].OITM WITH (NOLOCK) WHERE ItemCode IN (:itemCodes)
    `, {
        replacements: { itemCodes },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows.reduce((acc, row) => { acc[row.ItemCode] = row.ItemName; return acc; }, {});
}

async function completeBox(transaction, preBinBoxID, completedBy) {
    await sequelize.query(`
        UPDATE T_PREBIN_BOX
        SET Status = 'COMPLETED', CompletedBy = :completedBy, CompletedAt = GETDATE()
        WHERE PreBinBoxID = :preBinBoxID
    `, {
        replacements: { completedBy, preBinBoxID },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Mirrors an aggregated box line into the existing final completion table. */
async function insertBinCompleteRow(transaction, { whsCode, boxNumber, grnNo, grnType, docNo, itemCode, itemName, itemGroup, qty, createdBy, scannedItemJson }) {
    await sequelize.query(`
        INSERT INTO T_BIN_COMPLETE
            (BinID, GRNNo, GRNType, DocNo, ItemCode, ItemName, ItemGroup, Quantity, BinningStatus, CreatedBy, CreatedDate, isDelete, ItemStatus, scannedItem, WhsCode)
        VALUES
            (:boxNumber, :grnNo, :grnType, :docNo, :itemCode, :itemName, :itemGroup, :qty, 'Completed', :createdBy, GETDATE(), 0, 'Completed', :scannedItemJson, :whsCode)
    `, {
        replacements: {
            whsCode, boxNumber, grnNo, grnType: grnType || '', docNo: docNo || '',
            itemCode, itemName, itemGroup, qty, createdBy, scannedItemJson
        },
        transaction,
        type: QueryTypes.INSERT
    });
}

/** Keeps ERP_Pre_Binning.Binning_Qty (the existing "already binned" counter) in sync with T_BIN_COMPLETE. */
async function syncBinningQty(transaction, grnNo, itemCode) {
    await sequelize.query(`
        UPDATE ERP_Pre_Binning
        SET Binning_Qty = (
            SELECT ISNULL(SUM(Quantity), 0) FROM T_BIN_COMPLETE WITH (NOLOCK)
            WHERE GRNNo = :grnNo AND ItemCode = :itemCode
        )
        WHERE GRNNo = :grnNo AND ItemCode = :itemCode
    `, {
        replacements: { grnNo, itemCode },
        transaction,
        type: QueryTypes.UPDATE
    });
}

module.exports = {
    getPreBinningWarehouses,
    isWarehouseAllowed,
    getWarehouseStock,
    findLatestBoxByNumber,
    lockLatestBoxByNumber,
    lockWarehouseItemStock,
    findGrnForItem,
    uniqueNumberExists,
    createBox,
    setBoxItemGroup,
    insertScannedItem,
    incrementBoxTotalQty,
    getBoxWithItems,
    lockBoxForCompletion,
    getItemCountForBox,
    getBoxItemsGroupedForCompletion,
    getItemNamesByCode,
    completeBox,
    insertBinCompleteRow,
    syncBinningQty
};
