const service = require('../service/labelPrintService');
const { LabelPrintError } = service;

const ERROR_STATUS = {
    VALIDATION_ERROR: 400,
    ITEM_REQUIRED: 400,
    INVALID_LABEL_DIMENSIONS: 400,
    INVALID_TEMPLATE_SECTIONS: 400,
    JOB_NOT_PRINTABLE: 409,
    JOB_NOT_FAILED: 409,
    PRINTER_NOT_CONFIGURED: 404,
    TEMPLATE_NOT_FOUND: 404,
    PRINT_JOB_NOT_FOUND: 404,
    PRINT_FAILED: 502
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

const createJob = async (req, res) => {
    try {
        const result = await service.createPrintJobAsync(req.body, req.user);
        return res.status(201).json(result);
    } catch (error) {
        return handleError(res, error);
    }
};

const printJob = async (req, res) => {
    try {
        const data = await service.printJobAsync(req.params.printJobId, req.body);
        return res.status(200).json({ success: true, message: 'Print job completed successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const retryJob = async (req, res) => {
    try {
        const data = await service.retryPrintJobAsync(req.params.printJobId);
        return res.status(200).json({ success: true, message: 'Print job retried successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const preview = async (req, res) => {
    try {
        const data = await service.getPreviewAsync(req.params.printJobId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    getConfig,
    createJob,
    printJob,
    retryJob,
    preview
};
