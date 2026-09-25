const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/** Sets the pallet's aggregate PickingStatus (PENDING | IN_PROGRESS | COMPLETED). Called inside the same transaction as the inventory deduction, after re-counting remaining pickable rows. */
async function updatePalletPickingStatus(transaction, palletMappingId, pickingStatus) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING SET PickingStatus = :pickingStatus WHERE PalletMappingID = :palletMappingId
    `, {
        replacements: { palletMappingId, pickingStatus },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Inserts one audit row per completed picking transaction. */
async function insertPickingHistory(transaction, {
    inventoryId, palletMappingId, palletId, boxNumber, itemCode, itemGroup,
    warehouseCode, locationCode, pickedQty, remainingQty, pickedBy
}) {
    const rows = await sequelize.query(`
        INSERT INTO T_PICKING_HISTORY
            (InventoryID, PalletMappingID, PalletID, BoxNumber, ItemCode, ItemGroup, WarehouseCode, LocationCode,
             PickedQty, RemainingQty, Status, PickedBy, PickedAt)
        OUTPUT INSERTED.PickingID, INSERTED.InventoryID, INSERTED.PalletMappingID, INSERTED.PalletID,
               INSERTED.BoxNumber, INSERTED.ItemCode, INSERTED.ItemGroup, INSERTED.WarehouseCode, INSERTED.LocationCode,
               INSERTED.PickedQty, INSERTED.RemainingQty, INSERTED.Status, INSERTED.PickedBy, INSERTED.PickedAt
        VALUES
            (:inventoryId, :palletMappingId, :palletId, :boxNumber, :itemCode, :itemGroup, :warehouseCode, :locationCode,
             :pickedQty, :remainingQty, 'COMPLETED', :pickedBy, GETDATE())
    `, {
        replacements: {
            inventoryId, palletMappingId, palletId, boxNumber, itemCode, itemGroup: itemGroup || null,
            warehouseCode: warehouseCode || null, locationCode: locationCode || null, pickedQty, remainingQty, pickedBy
        },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

/* ------------------------------------------------------------------------------------------------
 * Source: SAP Business One Stock Transfer Requests (read-only, cross-database [BBLive])
 * ---------------------------------------------------------------------------------------------- */

/**
 * Open Stock Transfer Request lines for one From -> To warehouse pair. Optionally restricted to a set
 * of DocEntries (Pick List creation re-reads the lines inside its transaction instead of trusting the
 * frontend).
 */
async function getOpenTransferRequestLines({ fromWarehouse, toWarehouse, docEntries, transaction }) {
    const filterByDoc = Array.isArray(docEntries) && docEntries.length > 0;
    return sequelize.query(`
        SELECT
            T0.DocEntry,
            T0.DocNum,
            T0.DocDate,
            T0.DocDueDate,
            T1.LineNum,
            T1.ItemCode,
            T1.Dscription AS ItemName,
            T1.Quantity AS RequestedQty,
            T1.OpenQty,
            T1.FromWhsCod AS FromWarehouse,
            W1.WhsName AS FromWarehouseName,
            T1.WhsCode AS ToWarehouse,
            W2.WhsName AS ToWarehouseName,
            T1.LineStatus
        FROM [BBLive].[dbo].OWTQ T0 WITH (NOLOCK)
        INNER JOIN [BBLive].[dbo].WTQ1 T1 WITH (NOLOCK)
            ON T0.DocEntry = T1.DocEntry
        LEFT JOIN [BBLive].[dbo].OWHS W1 WITH (NOLOCK)
            ON T1.FromWhsCod = W1.WhsCode
        LEFT JOIN [BBLive].[dbo].OWHS W2 WITH (NOLOCK)
            ON T1.WhsCode = W2.WhsCode
        WHERE T1.LineStatus = 'O'
          AND T1.FromWhsCod = :fromWarehouse
          AND T1.WhsCode = :toWarehouse
          ${filterByDoc ? 'AND T0.DocEntry IN (:docEntries)' : ''}
        ORDER BY T0.DocNum, T1.LineNum
    `, {
        replacements: { fromWarehouse, toWarehouse, docEntries: filterByDoc ? docEntries : null },
        transaction,
        type: QueryTypes.SELECT
    });
}

/** DocEntry -> DocNum for the given DocEntries, regardless of line status (to tell "not found" from "no open lines"). */
async function getTransferRequestHeaders(docEntries, transaction) {
    if (!docEntries || docEntries.length === 0) return [];
    return sequelize.query(`
        SELECT DocEntry, DocNum, DocStatus, CANCELED AS Canceled
        FROM [BBLive].[dbo].OWTQ WITH (NOLOCK)
        WHERE DocEntry IN (:docEntries)
    `, {
        replacements: { docEntries },
        transaction,
        type: QueryTypes.SELECT
    });
}

/**
 * Quantity of each source STR line already reserved by an existing Pick List.
 * A Pick List stops reserving once its SAP Stock Transfer has been posted WITH base-document links,
 * because from then on SAP itself has reduced WTQ1.OpenQty. Cancelled Pick Lists never reserve.
 * Returned per (SourceDocEntry, SourceLineNum).
 */
async function getReservedQtyBySourceLines(transaction, docEntries) {
    const filterByDoc = Array.isArray(docEntries) && docEntries.length > 0;
    return sequelize.query(`
        SELECT d.SourceDocEntry, d.SourceLineNum, SUM(d.RequestedQty) AS ReservedQty
        FROM T_PICK_LIST_DETAIL d WITH (NOLOCK)
        INNER JOIN T_PICK_LIST h WITH (NOLOCK) ON h.PickListID = d.PickListID
        WHERE h.Status <> 'CANCELLED'
          AND NOT (h.StockTransferDocEntry IS NOT NULL AND ISNULL(h.SapBaseLinked, 0) = 1)
          ${filterByDoc ? 'AND d.SourceDocEntry IN (:docEntries)' : ''}
        GROUP BY d.SourceDocEntry, d.SourceLineNum
    `, {
        replacements: { docEntries: filterByDoc ? docEntries : null },
        transaction,
        type: QueryTypes.SELECT
    });
}

/**
 * Serializes Pick List creation across all API instances for the life of the transaction, so two
 * operators generating a Pick List from the same STR at the same moment cannot both reserve the same
 * remaining quantity. Throws if the lock cannot be obtained within the timeout.
 */
async function acquirePickListCreationLock(transaction) {
    const rows = await sequelize.query(`
        DECLARE @result INT;
        EXEC @result = sp_getapplock @Resource = 'WMS_PICK_LIST_CREATE', @LockMode = 'Exclusive',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
        SELECT @result AS result;
    `, {
        transaction,
        type: QueryTypes.SELECT
    });
    const result = rows && rows[0] ? Number(rows[0].result) : -999;
    return result >= 0;
}

/* ------------------------------------------------------------------------------------------------
 * Pick List header / detail
 * ---------------------------------------------------------------------------------------------- */

const HEADER_COLUMNS = `
    PickListID, PickListNumber, Status, FromWarehouse, ToWarehouse, TotalRequestedQty, TotalPickedQty,
    CreatedBy, CreatedDate, CompletedBy, CompletedDate, CONVERT(VARCHAR(10), CompletedDate, 23) AS CompletedDateText,
    DCID, DCNumber, StockTransferDocEntry, StockTransferDocNum, StockTransferNumber, SapBaseLinked,
    StockTransferPostedDate, ProcessingToken, ProcessingStartedAt,
    DATEDIFF(SECOND, ProcessingStartedAt, GETDATE()) AS ProcessingAgeSeconds,
    LastErrorStage, LastErrorMessage, LastErrorDate, RetryCount, UpdatedBy, UpdatedDate`;

const DETAIL_COLUMNS = `
    PickListDetailID, PickListID, SourceDocEntry, SourceDocNum, SourceLineNum, SourceDocDate, SourceDocDueDate,
    ItemCode, ItemName, SourceOpenQty, RequestedQty, PickedQty, RemainingQty, FromWarehouse, ToWarehouse, Status`;

async function insertPickListHeader(transaction, { fromWarehouse, toWarehouse, totalRequestedQty, createdBy }) {
    const rows = await sequelize.query(`
        INSERT INTO T_PICK_LIST (Status, FromWarehouse, ToWarehouse, TotalRequestedQty, TotalPickedQty, CreatedBy, CreatedDate)
        OUTPUT INSERTED.PickListID, INSERTED.PickListNumber, INSERTED.Status, INSERTED.FromWarehouse,
               INSERTED.ToWarehouse, INSERTED.TotalRequestedQty, INSERTED.CreatedBy, INSERTED.CreatedDate
        VALUES ('OPEN', :fromWarehouse, :toWarehouse, :totalRequestedQty, 0, :createdBy, GETDATE())
    `, {
        replacements: { fromWarehouse, toWarehouse, totalRequestedQty, createdBy },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function insertPickListDetail(transaction, {
    pickListId, sourceDocEntry, sourceDocNum, sourceLineNum, sourceDocDate, sourceDocDueDate,
    itemCode, itemName, sourceOpenQty, requestedQty, fromWarehouse, toWarehouse
}) {
    const rows = await sequelize.query(`
        INSERT INTO T_PICK_LIST_DETAIL
            (PickListID, SourceDocEntry, SourceDocNum, SourceLineNum, SourceDocDate, SourceDocDueDate,
             ItemCode, ItemName, SourceOpenQty, RequestedQty, PickedQty, RemainingQty, FromWarehouse, ToWarehouse, Status)
        OUTPUT INSERTED.PickListDetailID, INSERTED.PickListID, INSERTED.SourceDocEntry, INSERTED.SourceDocNum,
               INSERTED.SourceLineNum, INSERTED.ItemCode, INSERTED.ItemName, INSERTED.SourceOpenQty,
               INSERTED.RequestedQty, INSERTED.PickedQty, INSERTED.RemainingQty,
               INSERTED.FromWarehouse, INSERTED.ToWarehouse, INSERTED.Status
        VALUES
            (:pickListId, :sourceDocEntry, :sourceDocNum, :sourceLineNum, :sourceDocDate, :sourceDocDueDate,
             :itemCode, :itemName, :sourceOpenQty, :requestedQty, 0, :requestedQty, :fromWarehouse, :toWarehouse, 'OPEN')
    `, {
        replacements: {
            pickListId, sourceDocEntry, sourceDocNum, sourceLineNum,
            sourceDocDate: sourceDocDate || null, sourceDocDueDate: sourceDocDueDate || null,
            itemCode, itemName: itemName || null, sourceOpenQty, requestedQty, fromWarehouse, toWarehouse
        },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function findPickListById(pickListId, transaction) {
    const rows = await sequelize.query(`
        SELECT ${HEADER_COLUMNS} FROM T_PICK_LIST WITH (NOLOCK) WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Header row locked for mutation. Always the FIRST lock taken by any Pick List write (fixed lock order: header -> detail -> pallet mapping -> inventory). */
async function lockPickListById(transaction, pickListId) {
    const rows = await sequelize.query(`
        SELECT ${HEADER_COLUMNS} FROM T_PICK_LIST WITH (UPDLOCK, ROWLOCK, HOLDLOCK) WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function listPickLists({ status, limit }) {
    const top = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return sequelize.query(`
        SELECT TOP (${top}) ${HEADER_COLUMNS},
               (SELECT COUNT(*) FROM T_PICK_LIST_DETAIL d WITH (NOLOCK) WHERE d.PickListID = h.PickListID) AS LineCount,
               STUFF((SELECT DISTINCT ',' + CAST(d.SourceDocNum AS VARCHAR(20))
                      FROM T_PICK_LIST_DETAIL d WITH (NOLOCK) WHERE d.PickListID = h.PickListID
                      FOR XML PATH('')), 1, 1, '') AS SourceDocNums
        FROM T_PICK_LIST h WITH (NOLOCK)
        WHERE (:status IS NULL OR h.Status = :status)
        ORDER BY h.PickListID DESC
    `, {
        replacements: { status: status || null },
        type: QueryTypes.SELECT
    });
}

async function getPickListDetails(pickListId, transaction) {
    return sequelize.query(`
        SELECT ${DETAIL_COLUMNS} FROM T_PICK_LIST_DETAIL WITH (NOLOCK)
        WHERE PickListID = :pickListId
        ORDER BY SourceDocNum, SourceLineNum
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
}

/** Every detail of a Pick List, locked — used by Complete to verify nothing is left to pick under lock. */
async function lockPickListDetails(transaction, pickListId) {
    return sequelize.query(`
        SELECT ${DETAIL_COLUMNS} FROM T_PICK_LIST_DETAIL WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PickListID = :pickListId
        ORDER BY SourceDocNum, SourceLineNum
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
}

async function lockPickListDetail(transaction, pickListDetailId) {
    const rows = await sequelize.query(`
        SELECT ${DETAIL_COLUMNS} FROM T_PICK_LIST_DETAIL WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PickListDetailID = :pickListDetailId
    `, {
        replacements: { pickListDetailId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Adds pickQty to an already-locked detail. The WHERE guard makes over-picking impossible even if a
 * caller forgot to validate; returns null when the guard rejected the update.
 */
async function applyPickToDetail(transaction, pickListDetailId, pickQty) {
    const rows = await sequelize.query(`
        UPDATE T_PICK_LIST_DETAIL
        SET PickedQty = PickedQty + :pickQty,
            RemainingQty = RemainingQty - :pickQty,
            Status = CASE WHEN RemainingQty - :pickQty <= 0 THEN 'PICKED' ELSE 'PARTIAL' END
        OUTPUT INSERTED.PickListDetailID, INSERTED.RequestedQty, INSERTED.PickedQty, INSERTED.RemainingQty, INSERTED.Status
        WHERE PickListDetailID = :pickListDetailId AND RemainingQty >= :pickQty
    `, {
        replacements: { pickListDetailId, pickQty },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Recomputes header totals from the details and rolls Status OPEN/IN_PROGRESS -> IN_PROGRESS/PICKED. Never touches a header already past PICKED. */
async function refreshPickListProgress(transaction, pickListId, updatedBy) {
    const rows = await sequelize.query(`
        UPDATE h
        SET TotalPickedQty = agg.PickedQty,
            Status = CASE WHEN agg.RemainingQty <= 0 THEN 'PICKED' ELSE 'IN_PROGRESS' END,
            UpdatedBy = :updatedBy, UpdatedDate = GETDATE()
        OUTPUT INSERTED.PickListID, INSERTED.Status, INSERTED.TotalRequestedQty, INSERTED.TotalPickedQty
        FROM T_PICK_LIST h
        CROSS APPLY (SELECT SUM(d.PickedQty) AS PickedQty, SUM(d.RemainingQty) AS RemainingQty
                     FROM T_PICK_LIST_DETAIL d WHERE d.PickListID = h.PickListID) agg
        WHERE h.PickListID = :pickListId AND h.Status IN ('OPEN', 'IN_PROGRESS')
    `, {
        replacements: { pickListId, updatedBy },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/* ------------------------------------------------------------------------------------------------
 * Pick transactions
 * ---------------------------------------------------------------------------------------------- */

async function insertPickTransaction(transaction, t) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_PICK_TRANSACTION
                (PickListID, PickListDetailID, SourceDocEntry, SourceDocNum, SourceLineNum, ItemCode, Warehouse,
                 LocationID, Location, InventoryID, PalletMappingID, PalletNumber, BoxID, BoxNumber,
                 AvailableQty, PickQty, PickingHistoryID, ClientRequestId, CreatedBy, CreatedDate)
            OUTPUT INSERTED.PickTransactionID, INSERTED.PickListID, INSERTED.PickListDetailID, INSERTED.SourceDocEntry,
                   INSERTED.SourceDocNum, INSERTED.SourceLineNum, INSERTED.ItemCode, INSERTED.Warehouse, INSERTED.Location,
                   INSERTED.PalletMappingID, INSERTED.PalletNumber, INSERTED.BoxID, INSERTED.BoxNumber,
                   INSERTED.AvailableQty, INSERTED.PickQty, INSERTED.CreatedBy, INSERTED.CreatedDate
            VALUES
                (:pickListId, :pickListDetailId, :sourceDocEntry, :sourceDocNum, :sourceLineNum, :itemCode, :warehouse,
                 :locationId, :location, :inventoryId, :palletMappingId, :palletNumber, :boxId, :boxNumber,
                 :availableQty, :pickQty, :pickingHistoryId, :clientRequestId, :createdBy, GETDATE())
        `, {
            replacements: {
                pickListId: t.pickListId, pickListDetailId: t.pickListDetailId,
                sourceDocEntry: t.sourceDocEntry, sourceDocNum: t.sourceDocNum, sourceLineNum: t.sourceLineNum,
                itemCode: t.itemCode, warehouse: t.warehouse, locationId: t.locationId || null, location: t.location || null,
                inventoryId: t.inventoryId, palletMappingId: t.palletMappingId, palletNumber: t.palletNumber,
                boxId: t.boxId || null, boxNumber: t.boxNumber, availableQty: t.availableQty, pickQty: t.pickQty,
                pickingHistoryId: t.pickingHistoryId || null, clientRequestId: t.clientRequestId || null, createdBy: t.createdBy
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

async function findPickTransactionByClientRequestId(pickListId, clientRequestId, transaction) {
    const rows = await sequelize.query(`
        SELECT t.PickTransactionID, t.PickListID, t.PickListDetailID, t.ItemCode, t.PickQty, d.RemainingQty
        FROM T_PICK_TRANSACTION t WITH (NOLOCK)
        INNER JOIN T_PICK_LIST_DETAIL d WITH (NOLOCK) ON d.PickListDetailID = t.PickListDetailID
        WHERE t.PickListID = :pickListId AND t.ClientRequestId = :clientRequestId
    `, {
        replacements: { pickListId, clientRequestId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function getPickTransactions(pickListId, transaction) {
    return sequelize.query(`
        SELECT PickTransactionID, PickListID, PickListDetailID, SourceDocEntry, SourceDocNum, SourceLineNum,
               ItemCode, Warehouse, LocationID, Location, InventoryID, PalletMappingID, PalletNumber, BoxID, BoxNumber,
               AvailableQty, PickQty, PickingHistoryID, CreatedBy, CreatedDate
        FROM T_PICK_TRANSACTION WITH (NOLOCK)
        WHERE PickListID = :pickListId
        ORDER BY PickTransactionID
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
}

/* ------------------------------------------------------------------------------------------------
 * Completion state machine (see sql/PickList_Schema.sql for the lifecycle)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Marks picking as validated-complete (PICKED), stamping CompletedBy/CompletedDate only the first time,
 * and takes the processing lease. Caller must hold the header lock and have verified every detail.
 */
async function beginCompletion(transaction, pickListId, { completedBy, processingToken }) {
    await sequelize.query(`
        UPDATE T_PICK_LIST
        SET Status = CASE WHEN Status IN ('OPEN', 'IN_PROGRESS') THEN 'PICKED' ELSE Status END,
            CompletedBy = ISNULL(CompletedBy, :completedBy),
            CompletedDate = ISNULL(CompletedDate, GETDATE()),
            ProcessingToken = :processingToken,
            ProcessingStartedAt = GETDATE(),
            RetryCount = CASE WHEN LastErrorStage IS NOT NULL THEN RetryCount + 1 ELSE RetryCount END,
            UpdatedBy = :completedBy, UpdatedDate = GETDATE()
        WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId, completedBy, processingToken },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Releases the lease only if this request still owns it. Runs in its own implicit transaction. */
async function releaseProcessingLease(pickListId, processingToken) {
    await sequelize.query(`
        UPDATE T_PICK_LIST SET ProcessingToken = NULL, ProcessingStartedAt = NULL
        WHERE PickListID = :pickListId AND ProcessingToken = :processingToken
    `, {
        replacements: { pickListId, processingToken },
        type: QueryTypes.UPDATE
    });
}

async function recordPickListError(pickListId, { stage, message, updatedBy }) {
    await sequelize.query(`
        UPDATE T_PICK_LIST
        SET LastErrorStage = :stage, LastErrorMessage = :message, LastErrorDate = GETDATE(),
            UpdatedBy = :updatedBy, UpdatedDate = GETDATE()
        WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId, stage, message: String(message || '').slice(0, 2000), updatedBy: updatedBy || null },
        type: QueryTypes.UPDATE
    });
}

async function markDCCreated(transaction, pickListId, { dcId, dcNumber, updatedBy }) {
    await sequelize.query(`
        UPDATE T_PICK_LIST
        SET DCID = :dcId, DCNumber = :dcNumber,
            Status = CASE WHEN Status = 'PICKED' THEN 'DC_CREATED' ELSE Status END,
            UpdatedBy = :updatedBy, UpdatedDate = GETDATE()
        WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId, dcId, dcNumber, updatedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Final step: stores the SAP references, marks COMPLETED, clears the lease and any previous error. */
async function markStockTransferPosted(transaction, pickListId, { docEntry, docNum, baseLinked, updatedBy }) {
    await sequelize.query(`
        UPDATE T_PICK_LIST
        SET StockTransferDocEntry = :docEntry, StockTransferDocNum = :docNum,
            StockTransferNumber = CAST(:docNum AS NVARCHAR(20)), SapBaseLinked = :baseLinked,
            StockTransferPostedDate = GETDATE(), Status = 'COMPLETED',
            ProcessingToken = NULL, ProcessingStartedAt = NULL,
            LastErrorStage = NULL, LastErrorMessage = NULL, LastErrorDate = NULL,
            UpdatedBy = :updatedBy, UpdatedDate = GETDATE()
        WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId, docEntry, docNum, baseLinked: baseLinked ? 1 : 0, updatedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Audit row for every completion stage. Never throws — auditing must not mask the real outcome. */
async function insertProcessLog({ pickListId, stage, result, message, requestBody, responseBody, createdBy }) {
    try {
        await sequelize.query(`
            INSERT INTO T_PICK_LIST_PROCESS_LOG (PickListID, Stage, Result, Message, RequestBody, ResponseBody, CreatedBy, CreatedDate)
            VALUES (:pickListId, :stage, :result, :message, :requestBody, :responseBody, :createdBy, GETDATE())
        `, {
            replacements: {
                pickListId, stage, result,
                message: message ? String(message).slice(0, 2000) : null,
                requestBody: requestBody ? JSON.stringify(requestBody) : null,
                responseBody: responseBody ? JSON.stringify(responseBody) : null,
                createdBy: createdBy || null
            },
            type: QueryTypes.INSERT
        });
    } catch (error) {
        console.error('Pick List process log insert failed:', error.message);
    }
}

async function getProcessLog(pickListId) {
    return sequelize.query(`
        SELECT ProcessLogID, Stage, Result, Message, CreatedBy, CreatedDate
        FROM T_PICK_LIST_PROCESS_LOG WITH (NOLOCK)
        WHERE PickListID = :pickListId
        ORDER BY ProcessLogID
    `, {
        replacements: { pickListId },
        type: QueryTypes.SELECT
    });
}

module.exports = {
    updatePalletPickingStatus,
    insertPickingHistory,
    getOpenTransferRequestLines,
    getTransferRequestHeaders,
    getReservedQtyBySourceLines,
    acquirePickListCreationLock,
    insertPickListHeader,
    insertPickListDetail,
    findPickListById,
    lockPickListById,
    listPickLists,
    getPickListDetails,
    lockPickListDetails,
    lockPickListDetail,
    applyPickToDetail,
    refreshPickListProgress,
    insertPickTransaction,
    findPickTransactionByClientRequestId,
    getPickTransactions,
    beginCompletion,
    releaseProcessingLease,
    recordPickListError,
    markDCCreated,
    markStockTransferPosted,
    insertProcessLog,
    getProcessLog
};
