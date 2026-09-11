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
async function upsertPrinterLastUsedSettings(printerName, { density, speed, gapMm, offsetMm, language }) {
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
        // Capability bounds (Min/MaxDensity, Min/MaxSpeed) here MUST match whichever language this
        // printer actually is — a Zebra printer first-seen with the TSPL bounds hard-coded here used
        // to get silently capped at density 15 (ZPL darkness goes to 30) and, worse, get tagged
        // Language='TSPL' forever, which is exactly what caused the wrong command syntax to keep
        // being sent to it on every print after the first.
        const resolvedLanguage = language === 'ZPL' ? 'ZPL' : 'TSPL';
        const bounds = resolvedLanguage === 'ZPL'
            ? { minDensity: 0, maxDensity: 30, minSpeed: 2, maxSpeed: 12 }
            : { minDensity: 1, maxDensity: 15, minSpeed: 1, maxSpeed: 4 };

        await sequelize.query(`
            INSERT INTO T_LABEL_PRINT_CONFIG
                (PrinterName, Density, Speed, GapMm, OffsetMm, IsActive, PrinterType, Language, MinDensity, MaxDensity, MinSpeed, MaxSpeed, SupportsGap, SupportsOffset)
            VALUES
                (:printerName, :density, :speed, :gapMm, :offsetMm, 1, 'Thermal', :language, :minDensity, :maxDensity, :minSpeed, :maxSpeed, 1, 1)
        `, {
            replacements: { printerName, density, speed, gapMm, offsetMm, language: resolvedLanguage, ...bounds },
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

/**
 * Atomically reserves `count` sequential running numbers for `printDate` (a 'YYYY-MM-DD' string)
 * and returns the inclusive [start, end] running-number range. Must be called inside the caller's
 * transaction. The UPDATE is tried first (the common case — today's row already exists); if no row
 * exists yet the INSERT creates it, with a retry-on-race for two requests both trying to create the
 * first row for a brand-new date at the same time.
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

module.exports = {
    getActivePrinterConfig,
    getPrinterCapabilityByName,
    upsertPrinterLastUsedSettings,
    getActiveTemplate,
    reserveLabelNumbers,
};
