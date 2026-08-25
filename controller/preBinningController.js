const service = require('../service/preBinningService');
const { PreBinningError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_QTY: 400,
    INVALID_QR: 400,
    INVALID_QR_FORMAT: 400,
    INVALID_BOX_QR: 400,
    WAREHOUSE_REQUIRED: 400,
    INVALID_WAREHOUSE: 400,
    BOX_NOT_FOUND: 404,
    ITEM_NOT_AVAILABLE: 404,
    BOX_EMPTY: 400,
    BOX_ALREADY_COMPLETED: 409,
    BOX_WAREHOUSE_MISMATCH: 409,
    BOX_ITEMGROUP_MISMATCH: 409,
    DUPLICATE_UNIQUE_NUMBER: 409
};

function logScanOutcome(req, action, outcome, extra) {
    console.log(JSON.stringify({
        action,
        outcome,
        user: req.user && req.user.UserName,
        whsCode: req.body ? req.body.whsCode : undefined,
        boxNumber: req.body ? req.body.boxNumber : undefined,
        itemCode: req.body ? req.body.itemCode : undefined,
        grnNo: req.body ? req.body.grnNo : undefined,
        itemGroup: req.body ? req.body.itemGroup : undefined,
        uniqueNumber: req.body ? req.body.uniqueNumber : undefined,
        qty: req.body ? req.body.qty : undefined,
        timestamp: new Date().toISOString(),
        ...extra
    }));
}

function handleError(res, error) {
    if (error instanceof PreBinningError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('PreBinning error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const getWarehouses = async (req, res) => {
    try {
        const data = await service.getPreBinningWarehousesAsync();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getWarehouseStock = async (req, res) => {
    try {
        const data = await service.getWarehouseStockAsync(req.query.whsCode);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const validateBox = async (req, res) => {
    try {
        const data = await service.validateBoxAsync(req.body);
        return res.status(200).json({ success: true, message: 'Box validated successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const scanItem = async (req, res) => {
    try {
        const data = await service.scanItemAsync(req.body, req.user);
        logScanOutcome(req, 'SCAN_ITEM', 'SUCCESS');
        return res.status(200).json({ success: true, message: 'Item scanned successfully', data });
    } catch (error) {
        logScanOutcome(req, 'SCAN_ITEM', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

const getBoxItems = async (req, res) => {
    try {
        const data = await service.getBoxItemsAsync(req.query.whsCode, req.params.boxNumber);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const completeBox = async (req, res) => {
    try {
        const data = await service.completeBoxAsync(req.body, req.user);
        logScanOutcome(req, 'COMPLETE_BOX', 'SUCCESS');
        return res.status(200).json({ success: true, message: 'Box completed successfully', data });
    } catch (error) {
        logScanOutcome(req, 'COMPLETE_BOX', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

module.exports = {
    getWarehouses,
    getWarehouseStock,
    validateBox,
    scanItem,
    getBoxItems,
    completeBox
};
