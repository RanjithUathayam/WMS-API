const service = require('../service/labelPrintService');
const { LabelPrintError } = service;

const ERROR_STATUS = {
    PRINTER_NOT_CONFIGURED: 404,
    TEMPLATE_NOT_FOUND: 404,
    INVALID_TEMPLATE_SECTIONS: 400,
    INVALID_LABEL_DIMENSIONS: 400,
};

function handleError(res, error) {
    if (error instanceof LabelPrintError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('LabelPrint error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const getConfig = async (req, res) => {
    try {
        const data = await service.getPrinterConfigAsync();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    getConfig,
};
