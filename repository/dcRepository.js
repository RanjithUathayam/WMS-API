const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

async function findDCByPickListId(pickListId, transaction) {
    const rows = await sequelize.query(`
        SELECT DCID, DCNumber, PickListID, DCDate, FromWarehouse, ToWarehouse, TotalQty, Status, CreatedBy, CreatedDate
        FROM T_DC WITH (NOLOCK)
        WHERE PickListID = :pickListId
    `, {
        replacements: { pickListId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** UX_DC_PICKLIST guarantees one DC per Pick List; a violation is surfaced as isDuplicateDC so the caller can re-read the existing DC. */
async function insertDC(transaction, { pickListId, dcDate, fromWarehouse, toWarehouse, totalQty, createdBy }) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_DC (PickListID, DCDate, FromWarehouse, ToWarehouse, TotalQty, Status, CreatedBy, CreatedDate)
            OUTPUT INSERTED.DCID, INSERTED.DCNumber, INSERTED.PickListID, INSERTED.DCDate, INSERTED.FromWarehouse,
                   INSERTED.ToWarehouse, INSERTED.TotalQty, INSERTED.Status, INSERTED.CreatedBy, INSERTED.CreatedDate
            VALUES (:pickListId, :dcDate, :fromWarehouse, :toWarehouse, :totalQty, 'CREATED', :createdBy, GETDATE())
        `, {
            replacements: { pickListId, dcDate, fromWarehouse, toWarehouse, totalQty, createdBy },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicate = new Error(`A DC already exists for Pick List ${pickListId}.`);
            duplicate.isDuplicateDC = true;
            throw duplicate;
        }
        throw error;
    }
}

async function insertDCDetail(transaction, { dcId, pickListDetailId, sourceDocEntry, sourceDocNum, sourceLineNum, itemCode, itemName, quantity, fromWarehouse, toWarehouse }) {
    await sequelize.query(`
        INSERT INTO T_DC_DETAIL
            (DCID, PickListDetailID, SourceDocEntry, SourceDocNum, SourceLineNum, ItemCode, ItemName, Quantity, FromWarehouse, ToWarehouse)
        VALUES
            (:dcId, :pickListDetailId, :sourceDocEntry, :sourceDocNum, :sourceLineNum, :itemCode, :itemName, :quantity, :fromWarehouse, :toWarehouse)
    `, {
        replacements: {
            dcId, pickListDetailId, sourceDocEntry, sourceDocNum, sourceLineNum,
            itemCode, itemName: itemName || null, quantity, fromWarehouse, toWarehouse
        },
        transaction,
        type: QueryTypes.INSERT
    });
}

async function getDCDetails(dcId) {
    return sequelize.query(`
        SELECT DCDetailID, DCID, PickListDetailID, SourceDocEntry, SourceDocNum, SourceLineNum,
               ItemCode, ItemName, Quantity, FromWarehouse, ToWarehouse
        FROM T_DC_DETAIL WITH (NOLOCK)
        WHERE DCID = :dcId
        ORDER BY SourceDocNum, SourceLineNum
    `, {
        replacements: { dcId },
        type: QueryTypes.SELECT
    });
}

module.exports = {
    findDCByPickListId,
    insertDC,
    insertDCDetail,
    getDCDetails
};
