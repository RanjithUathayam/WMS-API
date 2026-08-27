const moment = require('moment');
const { sequelize } = require('../config/database');
const repository = require('../repository/labelPrintRepository');

class LabelPrintError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const PRINTABLE_STATUSES = ['Generated', 'Failed'];

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function toPositiveInt(value, fieldName) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
        throw new LabelPrintError('VALIDATION_ERROR', `${fieldName} must be a positive integer.`);
    }
    return num;
}

/** Label Number = current server date (YYYYMMDD) + zero-padded running number. */
function formatLabelNumber(datePrefix, runningNumber) {
    return `${datePrefix}${String(runningNumber).padStart(4, '0')}`;
}

/** itemId is stored as NVARCHAR (real-world item ids aren't always numeric) but echoed back as a
 *  number when it looks like one, so a numeric itemId in the request comes back numeric in the response. */
function coerceItemId(value) {
    return /^-?\d+$/.test(value) ? Number(value) : value;
}

function mapPrinterConfigRow(row) {
    return { printerName: row.PrinterName, density: Number(row.Density), speed: Number(row.Speed) };
}

function mapTemplateRow(row) {
    return {
        templateId: row.TemplateID,
        templateName: row.TemplateName,
        labelWidth: Number(row.LabelWidth),
        labelHeight: Number(row.LabelHeight),
        gap: Number(row.Gap),
        brandSectionWidth: Number(row.BrandSectionWidth),
        centerSectionWidth: Number(row.CenterSectionWidth),
        hologramSectionWidth: Number(row.HologramSectionWidth),
        logo: row.Logo,
        brandName: row.BrandName,
        tagline: row.Tagline,
        manufacturerName: row.ManufacturerName,
        manufacturerAddress: row.ManufacturerAddress,
        contact: row.Contact,
        email: row.Email,
        website: row.Website,
        registrationNumber: row.RegistrationNumber,
        hologramImage: row.HologramImage,
        hologramEnabled: Number(row.HologramSectionWidth) > 0
    };
}

async function getActivePrinterConfigOrThrow() {
    const row = await repository.getActivePrinterConfig();
    if (!row) {
        throw new LabelPrintError('PRINTER_NOT_CONFIGURED', 'No active printer configuration was found.');
    }
    return mapPrinterConfigRow(row);
}

/** Loads templateId if given (must exist), else the single active template. Always validates section widths. */
async function resolveTemplate(templateId) {
    const row = isBlank(templateId) ? await repository.getActiveTemplate() : await repository.getTemplateById(templateId);
    if (!row) {
        throw new LabelPrintError('TEMPLATE_NOT_FOUND', isBlank(templateId) ? 'No active label template was found.' : `Template ${templateId} was not found.`);
    }
    const template = mapTemplateRow(row);

    const sectionSum = template.brandSectionWidth + template.centerSectionWidth + template.hologramSectionWidth;
    if (sectionSum < 99.5 || sectionSum > 100.5) {
        throw new LabelPrintError('INVALID_TEMPLATE_SECTIONS', `Template ${template.templateId} section widths must sum to 100 (got ${sectionSum}).`);
    }
    if (template.labelWidth <= 0 || template.labelHeight <= 0 || template.gap < 0) {
        throw new LabelPrintError('INVALID_LABEL_DIMENSIONS', `Template ${template.templateId} has invalid label dimensions.`);
    }

    return template;
}

/** GET /api/label-print/config — merges active printer settings with the active template's brand summary. */
async function getPrinterConfigAsync() {
    const printerConfig = await getActivePrinterConfigOrThrow();
    const template = await resolveTemplate(null);

    return {
        printerName: printerConfig.printerName,
        labelWidth: template.labelWidth,
        labelHeight: template.labelHeight,
        gap: template.gap,
        density: printerConfig.density,
        speed: printerConfig.speed,
        template: {
            brandName: template.brandName,
            tagline: template.tagline,
            manufacturerName: template.manufacturerName,
            hologramEnabled: template.hologramEnabled,
            // Section widths as % of labelWidth — the SAME percentages the print command generator
            // uses to compute the printable area (see printerCommandService.buildTsplCommand), so the
            // preview and the physical print can never disagree about where content is allowed to go.
            brandSectionWidth: template.brandSectionWidth,
            centerSectionWidth: template.centerSectionWidth,
            hologramSectionWidth: template.hologramSectionWidth
        }
    };
}

/**
 * Validates items[] and expands it into one label-assignment slot per unique label, in item order —
 * e.g. itemA.labelQty=3 then itemB.labelQty=2 produces 5 slots: [A,A,A,B,B]. The item's own product
 * data (sku/productName/...) is trusted from the request body — see the SQL schema header for why
 * (no backend item master has this exact field set keyed by a numeric id).
 */
function validateAndAssignItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new LabelPrintError('VALIDATION_ERROR', 'items must be a non-empty array.');
    }

    const assignments = [];
    for (const item of items) {
        if (isBlank(item.itemId)) {
            throw new LabelPrintError('ITEM_REQUIRED', 'Each item requires an itemId.');
        }
        if (isBlank(item.sku)) {
            throw new LabelPrintError('VALIDATION_ERROR', `Item ${item.itemId} requires a sku.`);
        }
        if (isBlank(item.productName)) {
            throw new LabelPrintError('VALIDATION_ERROR', `Item ${item.itemId} requires a productName.`);
        }
        const labelQty = toPositiveInt(item.labelQty, `labelQty for item ${item.itemId}`);

        const mrp = item.mrp === undefined || item.mrp === null ? null : Number(item.mrp);
        if (mrp !== null && Number.isNaN(mrp)) {
            throw new LabelPrintError('VALIDATION_ERROR', `mrp for item ${item.itemId} must be a number.`);
        }

        for (let i = 0; i < labelQty; i++) {
            assignments.push({
                itemId: String(item.itemId).trim(),
                sku: String(item.sku).trim(),
                productName: String(item.productName).trim(),
                styleNo: isBlank(item.styleNo) ? null : String(item.styleNo).trim(),
                customer: isBlank(item.customer) ? null : String(item.customer).trim(),
                size: isBlank(item.size) ? null : String(item.size).trim(),
                color: isBlank(item.color) ? null : String(item.color).trim(),
                mrp
            });
        }
    }
    return assignments;
}

function validatePrinterNameOverride(printerName, fallback) {
    const name = isBlank(printerName) ? fallback : String(printerName).trim();
    if (isBlank(name)) {
        throw new LabelPrintError('PRINTER_NOT_CONFIGURED', 'Printer name is required.');
    }
    return name;
}

/**
 * Reserves `assignments.length` unique Label Numbers (server date + sequential running number)
 * inside the caller's transaction and pairs each with its assigned item and the QR value, which is
 * always identical to the Label Number. This is the single choke point for Label Number issuance,
 * so two concurrent callers can never receive overlapping numbers (see repository.reserveLabelNumbers).
 */
async function reserveAndBuildLabels(transaction, assignments, copies) {
    const now = moment();
    const datePrefix = now.format('YYYYMMDD');
    const printDate = now.format('YYYY-MM-DD');

    const { start } = await repository.reserveLabelNumbers(transaction, printDate, assignments.length);

    return assignments.map((assignment, i) => {
        const labelNumber = formatLabelNumber(datePrefix, start + i);
        return { labelNumber, qrValue: labelNumber, copies, ...assignment };
    });
}

function mapJobRow(row) {
    return {
        printJobId: row.PrintJobID,
        templateId: row.TemplateID,
        printerName: row.PrinterName,
        labelWidth: Number(row.LabelWidth),
        labelHeight: Number(row.LabelHeight),
        gap: Number(row.Gap),
        density: Number(row.Density),
        speed: Number(row.Speed),
        labelCount: row.LabelCount,
        copies: row.Copies,
        totalPhysicalPrints: row.TotalPhysicalPrints,
        status: row.Status,
        errorMessage: row.ErrorMessage,
        createdAt: row.CreatedAt,
        startedAt: row.StartedAt,
        completedAt: row.CompletedAt
    };
}

function mapRecordRow(row) {
    return {
        labelNumber: row.LabelNumber,
        qrValue: row.QRValue,
        itemId: coerceItemId(row.ItemID),
        sku: row.SKU,
        productName: row.ProductName,
        styleNo: row.StyleNo,
        customer: row.Customer,
        size: row.Size,
        color: row.Color,
        mrp: row.MRP === null ? null : Number(row.MRP),
        copies: row.Copies,
        status: row.Status,
        errorMessage: row.ErrorMessage,
        printedAt: row.PrintedAt,
        failedAt: row.FailedAt
    };
}

/**
 * POST /api/label-print/job — the authoritative Label Count is calculated from sum(items[].labelQty),
 * never trusted from the request body. Validates items, copies, template and printer, then reserves
 * Label Numbers and persists the job + one T_LABEL_RECORD row per unique label, all in one transaction
 * so a failure anywhere rolls back and no Label Number is left partially allocated.
 */
async function createPrintJobAsync(body, user) {
    const copies = toPositiveInt(body.copies, 'copies');
    const assignments = validateAndAssignItems(body.items);
    const labelCount = assignments.length; // authoritative — never taken from body.labelCount

    const template = await resolveTemplate(body.templateId);
    const printerConfig = isBlank(body.printerName) ? await getActivePrinterConfigOrThrow() : null;
    const printerName = validatePrinterNameOverride(body.printerName, printerConfig && printerConfig.printerName);
    const density = printerConfig ? printerConfig.density : Number(body.density);
    const speed = printerConfig ? printerConfig.speed : Number(body.speed);
    if (!Number.isFinite(density) || density <= 0) throw new LabelPrintError('INVALID_LABEL_DIMENSIONS', 'density must be greater than zero.');
    if (!Number.isFinite(speed) || speed <= 0) throw new LabelPrintError('INVALID_LABEL_DIMENSIONS', 'speed must be greater than zero.');

    const createdBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        const labels = await reserveAndBuildLabels(transaction, assignments, copies);

        const jobRow = await repository.createPrintJob(transaction, {
            templateId: template.templateId,
            printerName,
            labelWidth: template.labelWidth,
            labelHeight: template.labelHeight,
            gap: template.gap,
            density,
            speed,
            labelCount,
            copies,
            totalPhysicalPrints: labelCount * copies,
            status: 'Generated',
            createdBy
        });

        const recordRows = [];
        for (const label of labels) {
            recordRows.push(await repository.insertLabelRecord(transaction, {
                printJobId: jobRow.PrintJobID,
                ...label,
                status: 'Generated'
            }));
        }

        return {
            success: true,
            printJobId: jobRow.PrintJobID,
            labelCount,
            copies,
            totalPhysicalPrints: labelCount * copies,
            labels: recordRows.map(row => ({
                labelNumber: row.LabelNumber,
                qrValue: row.QRValue,
                itemId: coerceItemId(row.ItemID),
                copies: row.Copies
            }))
        };
    });
}

async function loadJobOrThrow(transaction, printJobId, { lock } = {}) {
    const job = lock
        ? await repository.lockJobById(transaction, printJobId)
        : await repository.findJobById(transaction, printJobId);
    if (!job) {
        throw new LabelPrintError('PRINT_JOB_NOT_FOUND', `Print job ${printJobId} was not found.`);
    }
    return job;
}

/**
 * Stand-in for the actual printer driver call (e.g. a TSC/Zebra SDK or raw socket write). Isolated
 * here so a real integration only has to replace this one function; printJobAsync/retryPrintJobAsync
 * already handle the Printing -> Printed/Failed status transitions and command generation context
 * (template + job dimensions) around it.
 */
async function performPrint(job, template, records, printerName) {
    void job;
    void template;
    void records;
    void printerName;
}

/** Shared by POST /.../print and POST /.../retry — moves a job through Printing to Printed/Failed. */
async function executePrint(transaction, job, printerNameOverride) {
    const printerName = isBlank(printerNameOverride) ? job.PrinterName : String(printerNameOverride).trim();
    const template = await resolveTemplate(job.TemplateID);
    const records = await repository.getRecordsForJob(transaction, job.PrintJobID);

    await repository.updateJobStatus(transaction, job.PrintJobID, 'Printing', { startedAt: true });
    await repository.updateRecordsStatusForJob(transaction, job.PrintJobID, 'Printing');

    try {
        await performPrint(job, template, records, printerName);
    } catch (error) {
        await repository.updateJobStatus(transaction, job.PrintJobID, 'Failed', { errorMessage: error.message, completedAt: true });
        await repository.updateRecordsStatusForJob(transaction, job.PrintJobID, 'Failed', { errorMessage: error.message, failedAt: true });
        throw new LabelPrintError('PRINT_FAILED', `Printing failed: ${error.message}`);
    }

    await repository.updateJobStatus(transaction, job.PrintJobID, 'Printed', { completedAt: true });
    await repository.updateRecordsStatusForJob(transaction, job.PrintJobID, 'Printed', { printedAt: true });

    const updatedJob = await repository.findJobById(transaction, job.PrintJobID);
    const updatedRecords = await repository.getRecordsForJob(transaction, job.PrintJobID);
    return { ...mapJobRow(updatedJob), labels: updatedRecords.map(mapRecordRow) };
}

/** POST /api/label-print/print/:printJobId — prints every Label Number in the job, `copies` times each. */
async function printJobAsync(printJobId, { printerName } = {}) {
    if (isBlank(printJobId)) {
        throw new LabelPrintError('VALIDATION_ERROR', 'printJobId is required.');
    }

    return sequelize.transaction(async (transaction) => {
        const job = await loadJobOrThrow(transaction, printJobId, { lock: true });
        if (!PRINTABLE_STATUSES.includes(job.Status)) {
            throw new LabelPrintError('JOB_NOT_PRINTABLE', `Print job ${printJobId} is in status ${job.Status} and cannot be printed.`);
        }
        return executePrint(transaction, job, printerName);
    });
}

/** POST /api/label-print/retry/:printJobId — reuses the existing Label Numbers/QR values/item data. */
async function retryPrintJobAsync(printJobId) {
    if (isBlank(printJobId)) {
        throw new LabelPrintError('VALIDATION_ERROR', 'printJobId is required.');
    }

    return sequelize.transaction(async (transaction) => {
        const job = await loadJobOrThrow(transaction, printJobId, { lock: true });
        if (job.Status !== 'Failed') {
            throw new LabelPrintError('JOB_NOT_FAILED', `Print job ${printJobId} is in status ${job.Status}; only a Failed job can be retried.`);
        }
        return executePrint(transaction, job, null);
    });
}

/** GET /api/label-print/job/:printJobId/preview — everything needed to render the physical label. */
async function getPreviewAsync(printJobId) {
    if (isBlank(printJobId)) {
        throw new LabelPrintError('VALIDATION_ERROR', 'printJobId is required.');
    }

    const job = await loadJobOrThrow(null, printJobId);
    const template = await resolveTemplate(job.TemplateID);
    const recordRows = await repository.getRecordsForJob(null, printJobId);

    return {
        template,
        job: mapJobRow(job),
        labels: recordRows.map(mapRecordRow)
    };
}

module.exports = {
    LabelPrintError,
    getPrinterConfigAsync,
    createPrintJobAsync,
    printJobAsync,
    retryPrintJobAsync,
    getPreviewAsync
};
