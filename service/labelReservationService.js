const moment = require('moment');
const { sequelize } = require('../config/database');
const sequenceRepository = require('../repository/labelPrintRepository');
const repository = require('../repository/labelReservationRepository');
const printerDetection = require('./printerDetectionService');
const printerCommand = require('./printerCommandService');

class LabelReservationError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// "labelCount must not exceed the configured maximum" (spec section 3) — no config store exists for
// this yet, so it's a named constant here; move to a config table if it ever needs to be tunable.
const MAX_LABEL_COUNT_PER_REQUEST = 1000;

const PRINTABLE_STATUSES = ['Reserved', 'Failed'];

// Fallback capability bounds for a printer with no T_LABEL_PRINT_CONFIG profile yet (e.g. one the OS
// just reported that nobody has registered/print-tuned before) — matches the spec's stated defaults.
const DEFAULT_CAPABILITY = { minDensity: 1, maxDensity: 15, minSpeed: 1, maxSpeed: 4, supportsGap: true, supportsOffset: true };
const DEFAULT_GAP_MM = 3;
const DEFAULT_OFFSET_MM = 0;
const DEFAULT_LABEL_WIDTH_MM = 90;
const DEFAULT_LABEL_HEIGHT_MM = 44;

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

/** Label Number = current server date (YYYYMMDD) + zero-padded running number. */
function formatLabelNumber(datePrefix, runningNumber) {
    return `${datePrefix}${String(runningNumber).padStart(4, '0')}`;
}

function mapReservationRow(row) {
    return {
        labelNumber: row.LabelNumber,
        qrValue: row.QRValue,
        status: row.Status
    };
}

function validateLabelCount(labelCount) {
    const num = Number(labelCount);
    if (!Number.isInteger(num)) {
        throw new LabelReservationError('VALIDATION_ERROR', 'Label count must be a valid integer.');
    }
    if (num <= 0) {
        throw new LabelReservationError('VALIDATION_ERROR', 'Label count must be greater than 0.');
    }
    if (num > MAX_LABEL_COUNT_PER_REQUEST) {
        throw new LabelReservationError('VALIDATION_ERROR', `Label count must not exceed ${MAX_LABEL_COUNT_PER_REQUEST}.`);
    }
    return num;
}

/**
 * POST /api/label/reserveLabelNumbers — reserves `labelCount` unique Label Numbers using the same
 * transaction-safe daily sequence as the /api/label-print job flow (repository.reserveLabelNumbers
 * in labelPrintRepository.js: locked UPDATE on T_LABEL_NUMBER_SEQUENCE, insert-with-retry for the
 * first request of a new date), then persists one T_LABEL_RESERVATION row per number so it can be
 * printed later by Label Number alone — no item/template data is required or accepted here.
 */
async function reserveLabelNumbersAsync(body) {
    const labelCount = validateLabelCount(body.labelCount);

    const rows = await sequelize.transaction(async (transaction) => {
        const now = moment();
        const datePrefix = now.format('YYYYMMDD');
        const printDate = now.format('YYYY-MM-DD');

        const { start } = await sequenceRepository.reserveLabelNumbers(transaction, printDate, labelCount);

        const inserted = [];
        for (let i = 0; i < labelCount; i++) {
            const labelNumber = formatLabelNumber(datePrefix, start + i);
            inserted.push(await repository.insertReservation(transaction, { labelNumber, qrValue: labelNumber }));
        }
        return inserted;
    });

    return {
        success: true,
        labelCount,
        labels: rows.map(row => ({ labelNumber: row.LabelNumber, qrValue: row.QRValue }))
    };
}

/**
 * `labelNumbers` (array of strings) + top-level `copies` is the original, working contract and stays
 * the primary path. `labels` is accepted as an alias — either an array of Label Number strings, or of
 * `{labelNumber, copies}` objects for a per-label copies override — falling back to the top-level
 * `copies` wherever an item doesn't specify its own. This is additive: nothing about the original
 * labelNumbers/copies contract changed, so anything already calling it keeps working unmodified.
 */
function normalizeLabelRequests(body) {
    const topLevelCopies = body.copies === undefined ? null : Number(body.copies);
    if (body.copies !== undefined && (!Number.isInteger(topLevelCopies) || topLevelCopies <= 0)) {
        throw new LabelReservationError('VALIDATION_ERROR', 'copies must be a positive integer.');
    }

    const source = Array.isArray(body.labelNumbers) ? body.labelNumbers
        : Array.isArray(body.labels) ? body.labels
        : null;

    if (!source || source.length === 0) {
        throw new LabelReservationError('VALIDATION_ERROR', 'labelNumbers (or labels) must be a non-empty array.');
    }

    const entries = source.map(item => {
        if (typeof item === 'string' || typeof item === 'number') {
            if (isBlank(item)) throw new LabelReservationError('VALIDATION_ERROR', 'labelNumbers must not contain blank values.');
            if (topLevelCopies === null) {
                throw new LabelReservationError('VALIDATION_ERROR', 'copies is required when labels are given as plain Label Numbers.');
            }
            return { labelNumber: String(item).trim(), copies: topLevelCopies };
        }
        if (item && !isBlank(item.labelNumber)) {
            const copies = item.copies === undefined ? topLevelCopies : Number(item.copies);
            if (!Number.isInteger(copies) || copies <= 0) {
                throw new LabelReservationError('VALIDATION_ERROR', `copies for label ${item.labelNumber} must be a positive integer.`);
            }
            return { labelNumber: String(item.labelNumber).trim(), copies };
        }
        throw new LabelReservationError('VALIDATION_ERROR', 'Each entry in labels must be a Label Number or an object with a labelNumber.');
    });

    const labelNumbers = entries.map(e => e.labelNumber);
    if (new Set(labelNumbers).size !== labelNumbers.length) {
        throw new LabelReservationError('VALIDATION_ERROR', 'labelNumbers must not contain duplicates.');
    }

    return entries;
}

function validateInteger(value, fieldName, { min, max }) {
    const num = Number(value);
    if (!Number.isInteger(num)) {
        throw new LabelReservationError('VALIDATION_ERROR', `${fieldName} must be an integer.`);
    }
    if (num < min || num > max) {
        throw new LabelReservationError('VALIDATION_ERROR', `Invalid printer ${fieldName}. ${fieldName[0].toUpperCase()}${fieldName.slice(1)} must be between ${min} and ${max}.`);
    }
    return num;
}

function validateNumeric(value, fieldName, { allowNegative = false } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        throw new LabelReservationError('VALIDATION_ERROR', `${fieldName} must be a number.`);
    }
    if (!allowNegative && num < 0) {
        throw new LabelReservationError('VALIDATION_ERROR', `${fieldName} must not be negative.`);
    }
    return num;
}

function validateMfgDate(value) {
    if (isBlank(value)) return null;
    const parsed = moment(value, moment.ISO_8601, true);
    if (!parsed.isValid()) {
        throw new LabelReservationError('VALIDATION_ERROR', 'mfgDate must be a valid date (YYYY-MM-DD).');
    }
    return parsed.format('YYYY-MM-DD');
}

/**
 * Resolves and validates every print-time setting (section 3-5 of the spec): printerName, mfgDate,
 * density, speed, gapMm, offsetMm, labelWidthMm, labelHeightMm. Bounds come from that printer's
 * T_LABEL_PRINT_CONFIG capability row when one exists, else the spec's stated defaults — so a printer
 * nobody has configured yet still gets sane validation instead of being rejected outright.
 */
async function resolvePrintSettings(body, printerName) {
    const capabilityRow = await sequenceRepository.getPrinterCapabilityByName(printerName);

    // Guards against the LabelPrinterCapability_Schema.sql migration not having been run yet: a row
    // can exist (from before that migration) with the new columns simply absent/undefined, which
    // must fall back to DEFAULT_CAPABILITY rather than silently disabling range validation.
    const hasCapabilityColumns = !!capabilityRow && capabilityRow.MinDensity !== undefined && capabilityRow.MinDensity !== null;
    const capability = hasCapabilityColumns ? {
        minDensity: capabilityRow.MinDensity, maxDensity: capabilityRow.MaxDensity,
        minSpeed: capabilityRow.MinSpeed, maxSpeed: capabilityRow.MaxSpeed,
        supportsGap: !!capabilityRow.SupportsGap, supportsOffset: !!capabilityRow.SupportsOffset
    } : DEFAULT_CAPABILITY;

    const density = validateInteger(
        body.density === undefined ? (capabilityRow && capabilityRow.Density != null ? capabilityRow.Density : 10) : body.density,
        'density', { min: capability.minDensity, max: capability.maxDensity }
    );
    const speed = validateInteger(
        body.speed === undefined ? (capabilityRow && capabilityRow.Speed != null ? capabilityRow.Speed : 2) : body.speed,
        'speed', { min: capability.minSpeed, max: capability.maxSpeed }
    );

    if (body.gapMm !== undefined && !capability.supportsGap) {
        throw new LabelReservationError('VALIDATION_ERROR', `Printer ${printerName} does not support a configurable gap.`);
    }
    const gapMm = validateNumeric(
        body.gapMm === undefined ? (hasCapabilityColumns ? capabilityRow.GapMm : DEFAULT_GAP_MM) : body.gapMm,
        'gapMm'
    );

    if (body.offsetMm !== undefined && !capability.supportsOffset) {
        throw new LabelReservationError('VALIDATION_ERROR', `Printer ${printerName} does not support a configurable offset.`);
    }
    const offsetMm = validateNumeric(
        body.offsetMm === undefined ? (hasCapabilityColumns ? capabilityRow.OffsetMm : DEFAULT_OFFSET_MM) : body.offsetMm,
        'offsetMm', { allowNegative: true } // alignment adjustments can legitimately be negative
    );

    const labelWidthMm = validateNumeric(body.labelWidthMm === undefined ? DEFAULT_LABEL_WIDTH_MM : body.labelWidthMm, 'labelWidthMm');
    const labelHeightMm = validateNumeric(body.labelHeightMm === undefined ? DEFAULT_LABEL_HEIGHT_MM : body.labelHeightMm, 'labelHeightMm');
    if (labelWidthMm <= 0) throw new LabelReservationError('VALIDATION_ERROR', 'labelWidthMm must be greater than zero.');
    if (labelHeightMm <= 0) throw new LabelReservationError('VALIDATION_ERROR', 'labelHeightMm must be greater than zero.');

    const mfgDate = validateMfgDate(body.mfgDate);

    // DPI drives every mm-to-dot conversion in the generated printer command (printerCommandService).
    // It comes from the printer's own profile, never guessed from screen/browser resolution — a 300
    // DPI printer must have that recorded in its T_LABEL_PRINT_CONFIG row (DPI column), else this
    // printer family's 203 DPI default is used.
    const dpiSource = capabilityRow && capabilityRow.DPI != null ? capabilityRow.DPI : printerCommand.DEFAULT_DPI;
    const dpi = validateInteger(body.dpi === undefined ? dpiSource : body.dpi, 'dpi', { min: 100, max: 1200 });

    const rotation = body.rotation === undefined ? 0 : Number(body.rotation);
    if (![0, 90, 180, 270].includes(rotation)) {
        throw new LabelReservationError('VALIDATION_ERROR', 'rotation must be one of 0, 90, 180, 270.');
    }

    return { density, speed, gapMm, offsetMm, labelWidthMm, labelHeightMm, mfgDate, dpi, rotation };
}

/**
 * Computes the label's printable/dynamic ("center") section in millimeters from the label's own left
 * edge, using the SAME BrandSectionWidth/CenterSectionWidth percentages the on-screen preview reads
 * (T_LABEL_TEMPLATE, via labelPrintService.getPrinterConfigAsync) — never a second, independent
 * layout. Falls back to treating the whole label as printable if no template is configured, so
 * printing still works rather than hard-failing on missing template data.
 */
async function resolvePrintableArea(labelWidthMm) {
    let template = null;
    try {
        template = await sequenceRepository.getActiveTemplate();
    } catch (error) {
        console.error('Unable to load the active label template for printable-area calculation:', error.message);
    }

    const brandPct = template ? Number(template.BrandSectionWidth) : NaN;
    const centerPct = template ? Number(template.CenterSectionWidth) : NaN;

    if (!Number.isFinite(brandPct) || !Number.isFinite(centerPct) || centerPct <= 0) {
        return { printableXMm: 0, printableWidthMm: labelWidthMm };
    }

    return {
        printableXMm: (brandPct / 100) * labelWidthMm,
        printableWidthMm: (centerPct / 100) * labelWidthMm
    };
}

/** Resolves the printer to print with: explicit request value, else the OS-reported default, else
 *  the single active DB config row, and validates it against live detection when detection works. */
async function resolvePrinterName(printerName) {
    let name = isBlank(printerName) ? null : String(printerName).trim();

    let detected = [];
    try {
        detected = await printerDetection.detectPrinters();
    } catch (error) {
        console.error('Printer detection unavailable while resolving print request:', error.message);
    }

    if (!name) {
        const osDefault = detected.find(p => p.isDefault);
        if (osDefault) {
            name = osDefault.name;
        } else {
            const config = await sequenceRepository.getActivePrinterConfig();
            if (!config) {
                throw new LabelReservationError('PRINTER_NOT_CONFIGURED', 'Printer name is required.');
            }
            name = config.PrinterName;
        }
    }

    if (detected.length > 0) {
        const match = detected.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!match) {
            throw new LabelReservationError('PRINTER_NOT_FOUND', `The selected printer is not available: ${name}.`);
        }
        if (match.status === 'offline') {
            throw new LabelReservationError('PRINTER_OFFLINE', `The selected printer is offline: ${name}.`);
        }
    }

    return name;
}

/**
 * POST /api/label/print — verifies every labelNumber was actually reserved (never accepts arbitrary
 * numbers), rejects any that are already Printed/Printing/Cancelled, builds the actual TSPL command
 * from the requested density/speed/gap/offset/dimensions, and sends it to the printer's spooler. A
 * previously Failed Label Number can be retried simply by calling this again with the same
 * labelNumbers — no new Label Number is ever generated for a retry.
 */
async function printLabelsAsync(body) {
    const entries = normalizeLabelRequests(body);
    const labelNumbers = entries.map(e => e.labelNumber);
    const printerName = await resolvePrinterName(body.printerName);
    const settings = await resolvePrintSettings(body, printerName);
    const printableArea = await resolvePrintableArea(settings.labelWidthMm);

    const result = await sequelize.transaction(async (transaction) => {
        const rows = await repository.lockReservationsByLabelNumbers(transaction, labelNumbers);

        const foundNumbers = new Set(rows.map(row => row.LabelNumber));
        const missing = labelNumbers.filter(number => !foundNumbers.has(number));
        if (missing.length) {
            throw new LabelReservationError('LABEL_NUMBERS_NOT_FOUND', `These Label Numbers were not reserved: ${missing.join(', ')}.`);
        }

        const notPrintable = rows.filter(row => !PRINTABLE_STATUSES.includes(row.Status));
        if (notPrintable.length) {
            throw new LabelReservationError('LABEL_NOT_PRINTABLE', `These Label Numbers are already ${notPrintable.map(r => `${r.LabelNumber} (${r.Status})`).join(', ')} and cannot be printed again.`);
        }

        const copiesByNumber = new Map(entries.map(e => [e.labelNumber, e.copies]));
        await Promise.all(labelNumbers.map(labelNumber =>
            repository.updateReservationsStatus(transaction, [labelNumber], 'Printing', { copies: copiesByNumber.get(labelNumber), printerName })
        ));

        let tsplCommand;
        try {
            tsplCommand = printerCommand.buildTsplCommand({
                ...settings,
                ...printableArea,
                printerName,
                labels: rows.map(row => ({ labelNumber: row.LabelNumber, qrValue: row.QRValue, copies: copiesByNumber.get(row.LabelNumber) }))
            });
        } catch (error) {
            await repository.updateReservationsStatus(transaction, labelNumbers, 'Failed', { errorMessage: error.message, failedAt: true });
            if (error instanceof printerCommand.PrintableAreaError) {
                // Never generate a potentially incorrect print job — surface exactly which element
                // and axis exceeded the printable area rather than silently clamping/warning.
                throw new LabelReservationError('PRINTABLE_AREA_EXCEEDED', error.message);
            }
            throw new LabelReservationError('PRINT_COMMAND_GENERATION_FAILED', 'Unable to generate the printer command for this label set.');
        }

        try {
            await printerDetection.sendRawToPrinterAsync(printerName, tsplCommand);
        } catch (error) {
            await repository.updateReservationsStatus(transaction, labelNumbers, 'Failed', { errorMessage: error.message, failedAt: true });
            if (error instanceof printerDetection.PrinterDetectionError) {
                throw new LabelReservationError(error.code, error.message);
            }
            throw new LabelReservationError('PRINT_FAILED', `Printing failed: ${error.message}`);
        }

        await repository.updateReservationsStatus(transaction, labelNumbers, 'Printed', { printedAt: true });

        const updated = await repository.lockReservationsByLabelNumbers(transaction, labelNumbers);
        return { updated, tsplCommand };
    });

    // Durable per-printer defaults (spec section 9) — best-effort; a failure here shouldn't undo an
    // already-successful print, so it's outside the print transaction and only logged on failure.
    sequenceRepository.upsertPrinterLastUsedSettings(printerName, settings).catch(error => {
        console.error(`Failed to persist last-used settings for printer ${printerName}:`, error.message);
    });

    const totalPhysicalPrints = entries.reduce((sum, e) => sum + e.copies, 0);
    return {
        success: true,
        message: 'Print job completed successfully',
        data: {
            printerName,
            ...settings,
            ...printableArea,
            labelCount: result.updated.length,
            totalPhysicalPrints,
            labels: result.updated.map(mapReservationRow),
            command: result.tsplCommand
        }
    };
}

/** GET /api/label/printers — the list a "Detect Printer" UI picks from; POST /printers/detect forces
 *  a fresh OS query instead of serving the short-lived cache. */
async function listPrintersAsync({ forceRefresh = false } = {}) {
    const printers = await printerDetection.detectPrinters({ forceRefresh });
    return { success: true, printers };
}

module.exports = {
    LabelReservationError,
    reserveLabelNumbersAsync,
    printLabelsAsync,
    listPrintersAsync
};
