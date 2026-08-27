const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/** Single active printer configuration (hardware settings only — dimensions live on the template). */
async function getActivePrinterConfig() {
    const rows = await sequelize.query(`
        SELECT TOP 1 ConfigID, PrinterName, Density, Speed
        FROM T_LABEL_PRINT_CONFIG WITH (NOLOCK)
        WHERE IsActive = 1
        ORDER BY ConfigID DESC
    `, { type: QueryTypes.SELECT });
    return rows[0] || null;
}

/** Every enabled printer configuration — the list a "Detect Printer" UI picks from. */
async function getAllPrinterConfigs() {
    return sequelize.query(`
        SELECT ConfigID, PrinterName, Density, Speed
        FROM T_LABEL_PRINT_CONFIG WITH (NOLOCK)
        WHERE IsActive = 1
        ORDER BY ConfigID
    `, { type: QueryTypes.SELECT });
}

/** Full capability + durable-defaults row for one printer by name (see LabelPrinterCapability_Schema.sql). */
async function getPrinterCapabilityByName(printerName) {
    const rows = await sequelize.query(`
        SELECT TOP 1 * FROM T_LABEL_PRINT_CONFIG WITH (NOLOCK) WHERE PrinterName = :printerName
    `, {
        replacements: { printerName },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Persists the settings actually used for a successful print as this printer's new durable defaults
 * — inserts a profile row (with the standard capability defaults) the first time this printer name is
 * seen, so an OS-detected printer that was never pre-registered still gets one after its first print.
 */
async function upsertPrinterLastUsedSettings(printerName, { density, speed, gapMm, offsetMm }) {
    const updated = await sequelize.query(`
        UPDATE T_LABEL_PRINT_CONFIG
        SET Density = :density, Speed = :speed, GapMm = :gapMm, OffsetMm = :offsetMm, UpdatedAt = GETDATE()
        WHERE PrinterName = :printerName
    `, {
        replacements: { printerName, density, speed, gapMm, offsetMm },
        type: QueryTypes.UPDATE
    });

    const affected = updated[1];
    if (!affected) {
        await sequelize.query(`
            INSERT INTO T_LABEL_PRINT_CONFIG
                (PrinterName, Density, Speed, GapMm, OffsetMm, IsActive, PrinterType, Language, MinDensity, MaxDensity, MinSpeed, MaxSpeed, SupportsGap, SupportsOffset)
            VALUES
                (:printerName, :density, :speed, :gapMm, :offsetMm, 1, 'Thermal', 'TSPL', 1, 15, 1, 4, 1, 1)
        `, {
            replacements: { printerName, density, speed, gapMm, offsetMm },
            type: QueryTypes.INSERT
        });
    }
}

/** Single active label template — brand/hologram content, section layout, physical dimensions. */
async function getActiveTemplate() {
    const rows = await sequelize.query(`
        SELECT TOP 1 * FROM T_LABEL_TEMPLATE WITH (NOLOCK)
        WHERE IsActive = 1
        ORDER BY TemplateID DESC
    `, { type: QueryTypes.SELECT });
    return rows[0] || null;
}

async function getTemplateById(templateId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 * FROM T_LABEL_TEMPLATE WITH (NOLOCK) WHERE TemplateID = :templateId
    `, {
        replacements: { templateId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/**
 * Atomically reserves `count` sequential running numbers for `printDate` (a 'YYYY-MM-DD' string)
 * and returns the inclusive [start, end] running-number range. Must be called inside the caller's
 * transaction. The UPDATE is tried first (the common case — today's row already exists); if no row
 * exists yet the INSERT creates it, with a retry-on-race for two requests both trying to create the
 * first row for a brand-new date at the same time (mirrors createBox in preBinningRepository.js).
 */
async function reserveLabelNumbers(transaction, printDate, count) {
    let rows = await sequelize.query(`
        UPDATE T_LABEL_NUMBER_SEQUENCE WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        SET LastRunningNumber = LastRunningNumber + :count, UpdatedAt = GETDATE()
        OUTPUT INSERTED.LastRunningNumber
        WHERE PrintDate = :printDate
    `, {
        replacements: { printDate, count },
        transaction,
        type: QueryTypes.SELECT
    });

    if (rows.length === 0) {
        try {
            rows = await sequelize.query(`
                INSERT INTO T_LABEL_NUMBER_SEQUENCE (PrintDate, LastRunningNumber, CreatedAt, UpdatedAt)
                OUTPUT INSERTED.LastRunningNumber
                VALUES (:printDate, :count, GETDATE(), GETDATE())
            `, {
                replacements: { printDate, count },
                transaction,
                type: QueryTypes.SELECT
            });
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // A concurrent request created today's row first — retry the locked update against it.
            rows = await sequelize.query(`
                UPDATE T_LABEL_NUMBER_SEQUENCE WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
                SET LastRunningNumber = LastRunningNumber + :count, UpdatedAt = GETDATE()
                OUTPUT INSERTED.LastRunningNumber
                WHERE PrintDate = :printDate
            `, {
                replacements: { printDate, count },
                transaction,
                type: QueryTypes.SELECT
            });
        }
    }

    const end = rows[0].LastRunningNumber;
    return { start: end - count + 1, end };
}

async function createPrintJob(transaction, job) {
    const rows = await sequelize.query(`
        INSERT INTO T_LABEL_PRINT_JOB
            (TemplateID, PrinterName, LabelWidth, LabelHeight, Gap, Density, Speed, LabelCount, Copies, TotalPhysicalPrints, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.*
        VALUES
            (:templateId, :printerName, :labelWidth, :labelHeight, :gap, :density, :speed, :labelCount, :copies, :totalPhysicalPrints, :status, :createdBy, GETDATE())
    `, {
        replacements: {
            templateId: job.templateId,
            printerName: job.printerName,
            labelWidth: job.labelWidth,
            labelHeight: job.labelHeight,
            gap: job.gap,
            density: job.density,
            speed: job.speed,
            labelCount: job.labelCount,
            copies: job.copies,
            totalPhysicalPrints: job.totalPhysicalPrints,
            status: job.status,
            createdBy: job.createdBy || null
        },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function insertLabelRecord(transaction, record) {
    const rows = await sequelize.query(`
        INSERT INTO T_LABEL_RECORD
            (PrintJobID, LabelNumber, QRValue, ItemID, SKU, ProductName, StyleNo, Customer, Size, Color, MRP, Copies, Status, CreatedAt)
        OUTPUT INSERTED.*
        VALUES
            (:printJobId, :labelNumber, :qrValue, :itemId, :sku, :productName, :styleNo, :customer, :size, :color, :mrp, :copies, :status, GETDATE())
    `, {
        replacements: {
            printJobId: record.printJobId,
            labelNumber: record.labelNumber,
            qrValue: record.qrValue,
            itemId: record.itemId,
            sku: record.sku,
            productName: record.productName,
            styleNo: record.styleNo || null,
            customer: record.customer || null,
            size: record.size || null,
            color: record.color || null,
            mrp: record.mrp === undefined || record.mrp === null ? null : record.mrp,
            copies: record.copies,
            status: record.status
        },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function findJobById(transaction, printJobId) {
    const rows = await sequelize.query(`
        SELECT * FROM T_LABEL_PRINT_JOB WITH (NOLOCK) WHERE PrintJobID = :printJobId
    `, {
        replacements: { printJobId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function lockJobById(transaction, printJobId) {
    const rows = await sequelize.query(`
        SELECT * FROM T_LABEL_PRINT_JOB WITH (UPDLOCK, ROWLOCK, HOLDLOCK) WHERE PrintJobID = :printJobId
    `, {
        replacements: { printJobId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function getRecordsForJob(transaction, printJobId) {
    return sequelize.query(`
        SELECT * FROM T_LABEL_RECORD WITH (NOLOCK) WHERE PrintJobID = :printJobId ORDER BY LabelID
    `, {
        replacements: { printJobId },
        transaction,
        type: QueryTypes.SELECT
    });
}

/**
 * StartedAt/CompletedAt are stamped with the database server's own GETDATE(), not the Node app
 * server's clock — startedAt/completedAt here are just booleans ("stamp this now or leave it alone"),
 * matching every other timestamp column in this codebase (CreatedAt/ReservedAt/UpdatedAt). Passing a
 * Node-computed Date through as a parameter would tie the stored timestamp to the app server's clock,
 * which can drift from the DB server's — exactly the kind of skew GETDATE() avoids everywhere else.
 */
async function updateJobStatus(transaction, printJobId, status, { errorMessage, startedAt, completedAt } = {}) {
    await sequelize.query(`
        UPDATE T_LABEL_PRINT_JOB
        SET Status = :status,
            ErrorMessage = :errorMessage,
            StartedAt = CASE WHEN :setStartedAt = 1 THEN GETDATE() ELSE StartedAt END,
            CompletedAt = CASE WHEN :setCompletedAt = 1 THEN GETDATE() ELSE CompletedAt END
        WHERE PrintJobID = :printJobId
    `, {
        replacements: {
            printJobId,
            status,
            errorMessage: errorMessage || null,
            setStartedAt: startedAt ? 1 : 0,
            setCompletedAt: completedAt ? 1 : 0
        },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/** Same GETDATE()-on-the-DB-server approach as updateJobStatus above — see its comment. */
async function updateRecordsStatusForJob(transaction, printJobId, status, { errorMessage, printedAt, failedAt } = {}) {
    await sequelize.query(`
        UPDATE T_LABEL_RECORD
        SET Status = :status,
            ErrorMessage = :errorMessage,
            PrintedAt = CASE WHEN :setPrintedAt = 1 THEN GETDATE() ELSE PrintedAt END,
            FailedAt = CASE WHEN :setFailedAt = 1 THEN GETDATE() ELSE FailedAt END
        WHERE PrintJobID = :printJobId
    `, {
        replacements: {
            printJobId,
            status,
            errorMessage: errorMessage || null,
            setPrintedAt: printedAt ? 1 : 0,
            setFailedAt: failedAt ? 1 : 0
        },
        transaction,
        type: QueryTypes.UPDATE
    });
}

module.exports = {
    getActivePrinterConfig,
    getAllPrinterConfigs,
    getPrinterCapabilityByName,
    upsertPrinterLastUsedSettings,
    getActiveTemplate,
    getTemplateById,
    reserveLabelNumbers,
    createPrintJob,
    insertLabelRecord,
    findJobById,
    lockJobById,
    getRecordsForJob,
    updateJobStatus,
    updateRecordsStatusForJob
};
