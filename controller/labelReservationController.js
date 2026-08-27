const service = require('../service/labelReservationService');
const { LabelReservationError } = service;

const ERROR_STATUS = {
    VALIDATION_ERROR: 400,
    LABEL_NUMBERS_NOT_FOUND: 400,
    LABEL_NOT_PRINTABLE: 409,
    PRINTER_NOT_CONFIGURED: 404,
    PRINTER_NOT_FOUND: 404,
    PRINTER_OFFLINE: 409,
    PRINTER_DETECTION_FAILED: 503,
    PRINT_COMMAND_GENERATION_FAILED: 500,
    PRINTABLE_AREA_EXCEEDED: 400,
    PRINT_FAILED: 502
};

function handleError(res, error) {
    if (error instanceof LabelReservationError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('LabelReservation error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const reserveLabelNumbers = async (req, res) => {
    try {
        const result = await service.reserveLabelNumbersAsync(req.body);
        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error);
    }
};

const printLabels = async (req, res) => {
    try {
        const result = await service.printLabelsAsync(req.body);
        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error);
    }
};

const listPrinters = async (req, res) => {
    try {
        const result = await service.listPrintersAsync();
        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error);
    }
};

const detectPrinters = async (req, res) => {
    try {
        const result = await service.listPrintersAsync({ forceRefresh: true });
        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    reserveLabelNumbers,
    printLabels,
    listPrinters,
    detectPrinters
};
