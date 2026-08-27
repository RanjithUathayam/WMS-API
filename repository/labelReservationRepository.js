const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function insertReservation(transaction, { labelNumber, qrValue }) {
    const rows = await sequelize.query(`
        INSERT INTO T_LABEL_RESERVATION (LabelNumber, QRValue, Status, CreatedAt, ReservedAt)
        OUTPUT INSERTED.*
        VALUES (:labelNumber, :qrValue, 'Reserved', GETDATE(), GETDATE())
    `, {
        replacements: { labelNumber, qrValue },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

/** Locks every reservation row matching the given Label Numbers, inside the caller's transaction. */
async function lockReservationsByLabelNumbers(transaction, labelNumbers) {
    return sequelize.query(`
        SELECT * FROM T_LABEL_RESERVATION WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE LabelNumber IN (:labelNumbers)
    `, {
        replacements: { labelNumbers },
        transaction,
        type: QueryTypes.SELECT
    });
}

/**
 * PrintedAt/FailedAt are stamped with the database server's own GETDATE(), not the Node app server's
 * clock — printedAt/failedAt here are just booleans ("stamp this now or leave it alone"), matching
 * every other timestamp column in this codebase (CreatedAt/ReservedAt/UpdatedAt). Passing a
 * Node-computed Date through as a parameter would tie the stored timestamp to the app server's clock,
 * which can drift from the DB server's — exactly the kind of skew GETDATE() avoids everywhere else.
 */
async function updateReservationsStatus(transaction, labelNumbers, status, { copies, printerName, errorMessage, printedAt, failedAt } = {}) {
    await sequelize.query(`
        UPDATE T_LABEL_RESERVATION
        SET Status = :status,
            Copies = COALESCE(:copies, Copies),
            PrinterName = COALESCE(:printerName, PrinterName),
            ErrorMessage = :errorMessage,
            PrintedAt = CASE WHEN :setPrintedAt = 1 THEN GETDATE() ELSE PrintedAt END,
            FailedAt = CASE WHEN :setFailedAt = 1 THEN GETDATE() ELSE FailedAt END
        WHERE LabelNumber IN (:labelNumbers)
    `, {
        replacements: {
            labelNumbers,
            status,
            copies: copies === undefined ? null : copies,
            printerName: printerName || null,
            errorMessage: errorMessage || null,
            setPrintedAt: printedAt ? 1 : 0,
            setFailedAt: failedAt ? 1 : 0
        },
        transaction,
        type: QueryTypes.UPDATE
    });
}

module.exports = {
    insertReservation,
    lockReservationsByLabelNumbers,
    updateReservationsStatus
};
