const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

const MASTER_PART_JOIN = `LEFT JOIN Master_Part mp WITH (NOLOCK) ON mp.ItemCode = %ALIAS%.ItemCode AND (mp.isDelete = 0 OR mp.isDelete IS NULL)`;

/* ------------------------------------------------------------------------------------------------
 * Warehouse / Rack. No master data: a rack is just (WarehouseCode, scanned Rack QR). It is stored in the
 * LocationCode columns of the T_RACK_* tables (see sql/RackManagement_NoMaster_Migration.sql).
 *
 * [BBLive] (CP850) and WMS_NEW (CP1) have different collations, so every SAP column that is compared
 * with / unioned against a WMS column must be COLLATE DATABASE_DEFAULT or SQL Server raises a collation conflict.
 * ---------------------------------------------------------------------------------------------- */

/** Active SAP B1 warehouses (OWHS). */
async function getRackWarehouses() {
    return sequelize.query(`
        SELECT
            w.WhsCode AS whsCode,
            w.WhsName AS whsName
        FROM [BBLive].[dbo].OWHS w WITH (NOLOCK)
        WHERE ISNULL(w.Inactive, 'N') <> 'Y'
        ORDER BY w.WhsCode;
    `, {
        type: QueryTypes.SELECT
    });
}

/** Canonical (correctly-cased) active warehouse from SAP OWHS, or null. */
async function findWarehouse(whsCode) {
    const rows = await sequelize.query(`
        SELECT TOP 1 w.WhsCode AS whsCode, w.WhsName AS whsName
        FROM [BBLive].[dbo].OWHS w WITH (NOLOCK)
        WHERE w.WhsCode = :whsCode AND ISNULL(w.Inactive, 'N') <> 'Y'
    `, {
        replacements: { whsCode },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Serializes every Save on one rack (there is no rack master row to lock). Transaction-owned app lock,
 * released automatically on commit/rollback. Throws if it cannot be acquired within 30s.
 */
async function lockRack(transaction, whsCode, rackCode) {
    const rows = await sequelize.query(`
        DECLARE @result INT;
        EXEC @result = sp_getapplock @Resource = :resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
        SELECT @result AS result;
    `, {
        replacements: { resource: `RACK|${whsCode}|${rackCode}`.toUpperCase().slice(0, 255) },
        transaction,
        type: QueryTypes.SELECT
    });
    const result = rows[0] ? Number(rows[0].result) : -999;
    if (result < 0) {
        throw new Error(`Could not lock rack ${rackCode} (sp_getapplock returned ${result}).`);
    }
}

/* ------------------------------------------------------------------------------------------------
 * Items
 * ---------------------------------------------------------------------------------------------- */

/** Item identity from SAP B1 OITM (the item master Pre-Binning validates against), with Master_Part as the name/group fallback. Null when neither knows the item. */
async function findItem(itemCode) {
    const rows = await sequelize.query(`
        SELECT 'SAP' AS Source, o.ItemCode COLLATE DATABASE_DEFAULT AS ItemCode, o.ItemName COLLATE DATABASE_DEFAULT AS ItemName, NULL AS ItemGroup
        FROM [BBLive].[dbo].OITM o WITH (NOLOCK)
        WHERE o.ItemCode = :itemCode
        UNION ALL
        SELECT 'WMS' AS Source, mp.ItemCode, mp.ItemName, mp.ItemGroup
        FROM Master_Part mp WITH (NOLOCK)
        WHERE mp.ItemCode = :itemCode AND (mp.isDelete = 0 OR mp.isDelete IS NULL)
    `, {
        replacements: { itemCode },
        type: QueryTypes.SELECT
    });
    if (rows.length === 0) return null;
    const sap = rows.find(r => r.Source === 'SAP');
    const wms = rows.find(r => r.Source === 'WMS');
    return {
        ItemCode: (sap || wms).ItemCode,
        ItemName: (sap && sap.ItemName) || (wms && wms.ItemName) || null,
        ItemGroup: (wms && wms.ItemGroup) || null
    };
}

/* ------------------------------------------------------------------------------------------------
 * Rack stock (T_RACK_INVENTORY)
 * ---------------------------------------------------------------------------------------------- */

/** Every item currently held in a rack (Quantity > 0), with item name. */
async function getRackStock(whsCode, rackCode) {
    return sequelize.query(`
        SELECT ri.RackInventoryID, ri.LocationID, ri.LocationCode, ri.WarehouseCode, ri.RowCode,
               ri.ItemCode, ri.ItemGroup, ri.Quantity, ri.UpdatedAt, ri.CreatedAt,
               mp.ItemName AS ItemName
        FROM T_RACK_INVENTORY ri WITH (NOLOCK)
        ${MASTER_PART_JOIN.replace('%ALIAS%', 'ri')}
        WHERE ri.WarehouseCode = :whsCode AND ri.LocationCode = :rackCode AND ri.Quantity > 0
        ORDER BY ri.ItemCode
    `, {
        replacements: { whsCode, rackCode },
        type: QueryTypes.SELECT
    });
}

async function findRackStockRow(whsCode, rackCode, itemCode) {
    const rows = await sequelize.query(`
        SELECT RackInventoryID, WarehouseCode, LocationCode, ItemCode, ItemGroup, Quantity
        FROM T_RACK_INVENTORY WITH (NOLOCK)
        WHERE WarehouseCode = :whsCode AND LocationCode = :rackCode AND ItemCode = :itemCode
    `, {
        replacements: { whsCode, rackCode, itemCode },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks the (rack, item) stock row for Save. HOLDLOCK also range-locks a not-yet-existing row, so two concurrent first-time stores of the same item serialize instead of racing on the insert. */
async function lockRackStockRow(transaction, whsCode, rackCode, itemCode) {
    const rows = await sequelize.query(`
        SELECT RackInventoryID, WarehouseCode, LocationCode, ItemCode, ItemGroup, Quantity
        FROM T_RACK_INVENTORY WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE WarehouseCode = :whsCode AND LocationCode = :rackCode AND ItemCode = :itemCode
    `, {
        replacements: { whsCode, rackCode, itemCode },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function insertRackStockRow(transaction, { locationCode, warehouseCode, itemCode, itemGroup, quantity, createdBy }) {
    const rows = await sequelize.query(`
        INSERT INTO T_RACK_INVENTORY (LocationID, LocationCode, WarehouseCode, RowCode, ItemCode, ItemGroup, Quantity, CreatedBy, CreatedAt)
        OUTPUT INSERTED.RackInventoryID, INSERTED.WarehouseCode, INSERTED.LocationCode, INSERTED.ItemCode, INSERTED.ItemGroup, INSERTED.Quantity
        VALUES (NULL, :locationCode, :warehouseCode, NULL, :itemCode, :itemGroup, :quantity, :createdBy, GETDATE())
    `, {
        replacements: { locationCode, warehouseCode, itemCode, itemGroup: itemGroup || null, quantity, createdBy },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

/** Sets the absolute quantity of an already-locked stock row (caller computed it under that lock). */
async function setRackStockQty(transaction, rackInventoryId, { quantity, itemGroup, updatedBy }) {
    await sequelize.query(`
        UPDATE T_RACK_INVENTORY
        SET Quantity = :quantity, ItemGroup = COALESCE(:itemGroup, ItemGroup), UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
        WHERE RackInventoryID = :rackInventoryId
    `, {
        replacements: { rackInventoryId, quantity, itemGroup: itemGroup || null, updatedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/* ------------------------------------------------------------------------------------------------
 * Labelled pieces (T_RACK_ITEM_TAG)
 * ---------------------------------------------------------------------------------------------- */

/** A labelled piece is identified by ItemType + GRNNo + UniqueNumber (see sql/RackManagement_TagKey_Migration.sql). */
async function findTag({ itemType, grnNo, uniqueNumber }) {
    const rows = await sequelize.query(`
        SELECT ItemType, ItemCode, GRNNo, UniqueNumber, Status, WarehouseCode, LocationCode, Qty, LastTransactionID
        FROM T_RACK_ITEM_TAG WITH (NOLOCK)
        WHERE ItemType = :itemType AND GRNNo = :grnNo AND UniqueNumber = :uniqueNumber
    `, {
        replacements: { itemType, grnNo, uniqueNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks a tag's state row (or, with HOLDLOCK, the key range where it would be inserted). */
async function lockTag(transaction, { itemType, grnNo, uniqueNumber }) {
    const rows = await sequelize.query(`
        SELECT ItemType, ItemCode, GRNNo, UniqueNumber, Status, WarehouseCode, LocationCode, Qty, LastTransactionID
        FROM T_RACK_ITEM_TAG WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE ItemType = :itemType AND GRNNo = :grnNo AND UniqueNumber = :uniqueNumber
    `, {
        replacements: { itemType, grnNo, uniqueNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function upsertTag(transaction, { itemType, itemCode, grnNo, uniqueNumber, status, warehouseCode, locationCode, qty, transactionId, updatedBy }) {
    await sequelize.query(`
        MERGE T_RACK_ITEM_TAG WITH (HOLDLOCK) AS target
        USING (SELECT :itemType AS ItemType, :grnNo AS GRNNo, :uniqueNumber AS UniqueNumber) AS src
            ON target.ItemType = src.ItemType AND target.GRNNo = src.GRNNo AND target.UniqueNumber = src.UniqueNumber
        WHEN MATCHED THEN
            UPDATE SET ItemCode = :itemCode, Status = :status, LocationID = NULL, WarehouseCode = :warehouseCode, LocationCode = :locationCode, Qty = :qty,
                       LastTransactionID = :transactionId, UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (ItemType, ItemCode, GRNNo, UniqueNumber, Status, LocationID, WarehouseCode, LocationCode, Qty, LastTransactionID, UpdatedBy, UpdatedAt)
            VALUES (:itemType, :itemCode, :grnNo, :uniqueNumber, :status, NULL, :warehouseCode, :locationCode, :qty, :transactionId, :updatedBy, GETDATE());
    `, {
        replacements: { itemType, itemCode, grnNo, uniqueNumber, status, warehouseCode, locationCode, qty, transactionId, updatedBy },
        transaction,
        type: QueryTypes.INSERT
    });
}

/* ------------------------------------------------------------------------------------------------
 * Transactions (T_RACK_TRANSACTION / T_RACK_TRANSACTION_DETAIL)
 * ---------------------------------------------------------------------------------------------- */

const TRANSACTION_COLUMNS = `RackTransactionID, TransactionNo, TransactionType, LocationID, LocationCode, WarehouseCode, RowCode,
               TotalLines, TotalQty, ClientRequestId, DeviceID, CreatedBy, CreatedAt`;

/** Inserts the batch header. A repeated ClientRequestId surfaces as an error flagged isDuplicateClientRequest. */
async function insertTransaction(transaction, h) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_RACK_TRANSACTION
                (TransactionType, LocationID, LocationCode, WarehouseCode, RowCode, TotalLines, TotalQty, ClientRequestId, DeviceID, CreatedBy, CreatedAt)
            OUTPUT INSERTED.RackTransactionID, INSERTED.TransactionNo, INSERTED.TransactionType, INSERTED.LocationID,
                   INSERTED.LocationCode, INSERTED.WarehouseCode, INSERTED.RowCode, INSERTED.TotalLines, INSERTED.TotalQty,
                   INSERTED.ClientRequestId, INSERTED.DeviceID, INSERTED.CreatedBy, INSERTED.CreatedAt
            VALUES
                (:transactionType, :locationId, :locationCode, :warehouseCode, :rowCode, :totalLines, :totalQty, :clientRequestId, :deviceId, :createdBy, GETDATE())
        `, {
            replacements: {
                transactionType: h.transactionType, locationId: null, locationCode: h.locationCode,
                warehouseCode: h.warehouseCode, rowCode: h.rowCode || null, totalLines: h.totalLines, totalQty: h.totalQty,
                clientRequestId: h.clientRequestId || null, deviceId: h.deviceId || null, createdBy: h.createdBy
            },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicate = new Error('Duplicate clientRequestId');
            duplicate.isDuplicateClientRequest = true;
            throw duplicate;
        }
        throw error;
    }
}

async function insertTransactionDetail(transaction, d) {
    await sequelize.query(`
        INSERT INTO T_RACK_TRANSACTION_DETAIL
            (RackTransactionID, LineNum, RackInventoryID, ItemCode, ItemGroup, ItemType, GRNNo, UniqueNumber, Qty, QtyBefore, QtyAfter)
        VALUES
            (:rackTransactionId, :lineNum, :rackInventoryId, :itemCode, :itemGroup, :itemType, :grnNo, :uniqueNumber, :qty, :qtyBefore, :qtyAfter)
    `, {
        replacements: {
            rackTransactionId: d.rackTransactionId, lineNum: d.lineNum, rackInventoryId: d.rackInventoryId,
            itemCode: d.itemCode, itemGroup: d.itemGroup || null, itemType: d.itemType || null,
            grnNo: d.grnNo || null, uniqueNumber: d.uniqueNumber || null,
            qty: d.qty, qtyBefore: d.qtyBefore, qtyAfter: d.qtyAfter
        },
        transaction,
        type: QueryTypes.INSERT
    });
}

async function findTransactionByClientRequestId(clientRequestId) {
    const rows = await sequelize.query(`
        SELECT ${TRANSACTION_COLUMNS}
        FROM T_RACK_TRANSACTION WITH (NOLOCK)
        WHERE ClientRequestId = :clientRequestId
    `, {
        replacements: { clientRequestId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function findTransactionById(rackTransactionId) {
    const rows = await sequelize.query(`
        SELECT ${TRANSACTION_COLUMNS}
        FROM T_RACK_TRANSACTION WITH (NOLOCK)
        WHERE RackTransactionID = :rackTransactionId
    `, {
        replacements: { rackTransactionId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function getTransactionDetails(rackTransactionId) {
    return sequelize.query(`
        SELECT d.RackTransactionDetailID, d.RackTransactionID, d.LineNum, d.RackInventoryID, d.ItemCode, d.ItemGroup,
               d.ItemType, d.GRNNo, d.UniqueNumber, d.Qty, d.QtyBefore, d.QtyAfter,
               mp.ItemName AS ItemName
        FROM T_RACK_TRANSACTION_DETAIL d WITH (NOLOCK)
        ${MASTER_PART_JOIN.replace('%ALIAS%', 'd')}
        WHERE d.RackTransactionID = :rackTransactionId
        ORDER BY d.LineNum
    `, {
        replacements: { rackTransactionId },
        type: QueryTypes.SELECT
    });
}

/** Paged, filtered history list (newest first). All filters optional; fromDate/toDate are inclusive calendar dates. */
async function listTransactions({ transactionType, warehouseCode, rackCode, itemCode, createdBy, fromDate, toDate, offset, limit }) {
    const where = ['1 = 1'];
    const replacements = { offset, limit };
    if (transactionType) { where.push('t.TransactionType = :transactionType'); replacements.transactionType = transactionType; }
    if (warehouseCode) { where.push('t.WarehouseCode = :warehouseCode'); replacements.warehouseCode = warehouseCode; }
    if (rackCode) { where.push('t.LocationCode = :rackCode'); replacements.rackCode = rackCode; }
    if (createdBy) { where.push('t.CreatedBy = :createdBy'); replacements.createdBy = createdBy; }
    if (fromDate) { where.push('t.CreatedAt >= :fromDate'); replacements.fromDate = fromDate; }
    if (toDate) { where.push('t.CreatedAt < DATEADD(DAY, 1, CAST(:toDate AS DATE))'); replacements.toDate = toDate; }
    if (itemCode) {
        where.push('EXISTS (SELECT 1 FROM T_RACK_TRANSACTION_DETAIL d WITH (NOLOCK) WHERE d.RackTransactionID = t.RackTransactionID AND d.ItemCode = :itemCode)');
        replacements.itemCode = itemCode;
    }
    const whereSql = where.join(' AND ');

    const [rows, countRows] = await Promise.all([
        sequelize.query(`
            SELECT ${TRANSACTION_COLUMNS.split(',').map(c => 't.' + c.trim()).join(', ')}
            FROM T_RACK_TRANSACTION t WITH (NOLOCK)
            WHERE ${whereSql}
            ORDER BY t.RackTransactionID DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        `, { replacements, type: QueryTypes.SELECT }),
        sequelize.query(`
            SELECT COUNT(*) AS total FROM T_RACK_TRANSACTION t WITH (NOLOCK) WHERE ${whereSql}
        `, { replacements, type: QueryTypes.SELECT })
    ]);
    return { rows, total: Number(countRows[0].total) };
}

module.exports = {
    isUniqueViolation,
    getRackWarehouses,
    findWarehouse,
    lockRack,
    findItem,
    getRackStock,
    findRackStockRow,
    lockRackStockRow,
    insertRackStockRow,
    setRackStockQty,
    findTag,
    lockTag,
    upsertTag,
    insertTransaction,
    insertTransactionDetail,
    findTransactionByClientRequestId,
    findTransactionById,
    getTransactionDetails,
    listTransactions
};
