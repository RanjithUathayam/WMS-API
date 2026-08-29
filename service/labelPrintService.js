const repository = require('../repository/labelPrintRepository');

class LabelPrintError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
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

/** Loads the single active template. Always validates section widths. */
async function resolveTemplate() {
    const row = await repository.getActiveTemplate();
    if (!row) {
        throw new LabelPrintError('TEMPLATE_NOT_FOUND', 'No active label template was found.');
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
    const template = await resolveTemplate();

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

module.exports = {
    LabelPrintError,
    getPrinterConfigAsync,
};
