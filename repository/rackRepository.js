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
 * Rack (= Location Master row, see sql/RackManagement_Schema.sql)
 * ---------------------------------------------------------------------------------------------- */

/** Warehouses that have at least one usable rack (non-INACTIVE location), named from SAP B1 OWHS. */
async function getRackWarehouses() {
    return sequelize.query(`
        SELECT l.WarehouseCode AS whsCode, MAX(w.WhsName) AS whsName, COUNT(*) AS rackCount
        FROM T_LOCATION l WITH (NOLOCK)
        LEFT JOIN [BBLive].[dbo].OWHS w WITH (NOLOCK) ON w.WhsCode = l.WarehouseCode
        WHERE l.Status <> 'INACTIVE'
        GROUP BY l.WarehouseCode
        ORDER BY l.WarehouseCode
    `, {
        type: QueryTypes.SELECT
    });
}

/** Read-only rack lookup by its scanned LocationCode — used by Scan Rack / Scan Item. Save re-reads it under lock via locationRepository.lockLocationByCode. */
async function findRackByCode(locationCode) {
    const rows = await sequelize.query(`
        SELECT LocationID, WarehouseCode, RowCode, PositionNo, LocationCode, Status
        FROM T_LOCATION WITH (NOLOCK)
        WHERE LocationCode = :locationCode
    `, {
        replacements: { locationCode },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/* ------------------------------------------------------------------------------------------------
 * Items
 * ---------------------------------------------------------------------------------------------- */

/** Item identity from SAP B1 OITM (the item master Pre-Binning validates against), with Master_Part as the name/group fallback. Null when neither knows the item. */
async function findItem(itemCode) {
    const rows = await sequelize.query(`
        SELECT 'SAP' AS Source, o.ItemCode, o.ItemName, NULL AS ItemGroup
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
async function getRackStock(locationId) {
    return sequelize.query(`
        SELECT ri.RackInventoryID, ri.LocationID, ri.LocationCode, ri.WarehouseCode, ri.RowCode,
               ri.ItemCode, ri.ItemGroup, ri.Quantity, ri.UpdatedAt, ri.CreatedAt,
               mp.ItemName AS ItemName
        FROM T_RACK_INVENTORY ri WITH (NOLOCK)
        ${MASTER_PART_JOIN.replace('%ALIAS%', 'ri')}
        WHERE ri.LocationID = :locationId AND ri.Quantity > 0
        ORDER BY ri.ItemCode
    `, {
        replacements: { locationId },
        type: QueryTypes.SELECT
    });
}

async function findRackStockRow(locationId, itemCode) {
    const rows = await sequelize.query(`
        SELECT RackInventoryID, LocationID, ItemCode, ItemGroup, Quantity
        FROM T_RACK_INVENTORY WITH (NOLOCK)
        WHERE LocationID = :locationId AND ItemCode = :itemCode
    `, {
        replacements: { locationId, itemCode },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks the (rack, item) stock row for Save. HOLDLOCK also range-locks a not-yet-existing row, so two concurrent first-time stores of the same item serialize instead of racing on the insert. */
async function lockRackStockRow(transaction, locationId, itemCode) {
    const rows = await sequelize.query(`
        SELECT RackInventoryID, LocationID, ItemCode, ItemGroup, Quantity
        FROM T_RACK_INVENTORY WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE LocationID = :locationId AND ItemCode = :itemCode
    `, {
        replacements: { locationId, itemCode },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function insertRackStockRow(transaction, { locationId, locationCode, warehouseCode, rowCode, itemCode, itemGroup, quantity, createdBy }) {
    const rows = await sequelize.query(`
        INSERT INTO T_RACK_INVENTORY (LocationID, LocationCode, WarehouseCode, RowCode, ItemCode, ItemGroup, Quantity, CreatedBy, CreatedAt)
        OUTPUT INSERTED.RackInventoryID, INSERTED.LocationID, INSERTED.ItemCode, INSERTED.ItemGroup, INSERTED.Quantity
        VALUES (:locationId, :locationCode, :warehouseCode, :rowCode, :itemCode, :itemGroup, :quantity, :createdBy, GETDATE())
    `, {
        replacements: { locationId, locationCode, warehouseCode, rowCode, itemCode, itemGroup, quantity, createdBy },
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

async function findTag({ itemCode, grnNo, uniqueNumber }) {
    const rows = await sequelize.query(`
        SELECT ItemCode, GRNNo, UniqueNumber, Status, LocationID, LocationCode, Qty, LastTransactionID
        FROM T_RACK_ITEM_TAG WITH (NOLOCK)
        WHERE ItemCode = :itemCode AND GRNNo = :grnNo AND UniqueNumber = :uniqueNumber
    `, {
        replacements: { itemCode, grnNo, uniqueNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks a tag's state row (or, with HOLDLOCK, the key range where it would be inserted). */
async function lockTag(transaction, { itemCode, grnNo, uniqueNumber }) {
    const rows = await sequelize.query(`
        SELECT ItemCode, GRNNo, UniqueNumber, Status, LocationID, LocationCode, Qty, LastTransactionID
        FROM T_RACK_ITEM_TAG WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE ItemCode = :itemCode AND GRNNo = :grnNo AND UniqueNumber = :uniqueNumber
    `, {
        replacements: { itemCode, grnNo, uniqueNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function upsertTag(transaction, { itemCode, grnNo, uniqueNumber, status, locationId, locationCode, qty, transactionId, updatedBy }) {
    await sequelize.query(`
        MERGE T_RACK_ITEM_TAG WITH (HOLDLOCK) AS target
        USING (SELECT :itemCode AS ItemCode, :grnNo AS GRNNo, :uniqueNumber AS UniqueNumber) AS src
            ON target.ItemCode = src.ItemCode AND target.GRNNo = src.GRNNo AND target.UniqueNumber = src.UniqueNumber
        WHEN MATCHED THEN
            UPDATE SET Status = :status, LocationID = :locationId, LocationCode = :locationCode, Qty = :qty,
                       LastTransactionID = :transactionId, UpdatedBy = :updatedBy, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (ItemCode, GRNNo, UniqueNumber, Status, LocationID, LocationCode, Qty, LastTransactionID, UpdatedBy, UpdatedAt)
            VALUES (:itemCode, :grnNo, :uniqueNumber, :status, :locationId, :locationCode, :qty, :transactionId, :updatedBy, GETDATE());
    `, {
        replacements: { itemCode, grnNo, uniqueNumber, status, locationId, locationCode, qty, transactionId, updatedBy },
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
                transactionType: h.transactionType, locationId: h.locationId, locationCode: h.locationCode,
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
    findRackByCode,
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
