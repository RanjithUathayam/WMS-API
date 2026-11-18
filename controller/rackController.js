const service = require('../service/rackService');
const { RackError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    WAREHOUSE_REQUIRED: 400,
    INVALID_REQUEST: 400,
    INVALID_MODE: 400,
    INVALID_ITEM_QR: 400,
    INVALID_QTY: 400,
    TOO_MANY_LINES: 400,
    RACK_NOT_FOUND: 404,
    ITEM_NOT_FOUND: 404,
    TRANSACTION_NOT_FOUND: 404,
    WAREHOUSE_MISMATCH: 409,
    RACK_INACTIVE: 409,
    RACK_BLOCKED: 409,
    RACK_EMPTY: 409,
    ITEM_NOT_IN_RACK: 409,
    INSUFFICIENT_STOCK: 409,
    DUPLICATE_SCAN: 409,
    TAG_ALREADY_STORED: 409,
    TAG_ALREADY_PICKED: 409
};

function handleError(res, error) {
    if (error instanceof RackError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            message: error.message,
            errorCode: error.code,
            code: error.code,
            data: error.data || null
        });
    }
    console.error('Rack management error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.', errorCode: 'INTERNAL_ERROR', code: 'INTERNAL_ERROR', data: null });
}

/** Wraps a service call in the standard { success, message, data } envelope. */
function handle(fn, message, status = 200) {
    return async (req, res) => {
        try {
            const data = await fn(req);
            const text = typeof message === 'function' ? message(data) : message;
            return res.status(status).json({ success: true, message: text, data });
        } catch (error) {
            return handleError(res, error);
        }
    };
}

const getWarehouses = handle(() => service.getWarehousesAsync(), 'Rack warehouses');

const scanRack = handle(req => service.scanRackAsync(req.body), data => `Rack ${data.rack.rackCode} validated`);

const scanItem = handle(req => service.scanItemAsync(req.body), data => `Item ${data.item.itemCode} validated`);

const save = handle(req => service.saveAsync(req.body, req.user),
    data => (data.duplicate
        ? `Transaction ${data.transactionNo} was already saved`
        : `${data.mode === 'STORE' ? 'Store' : 'Picking'} ${data.transactionNo} saved successfully`), 201);

const listHistory = handle(req => service.listHistoryAsync(req.query), 'Rack transactions');

const getHistory = handle(req => service.getHistoryAsync(req.params.transactionId), 'Rack transaction');

module.exports = {
    getWarehouses,
    scanRack,
    scanItem,
    save,
    listHistory,
    getHistory
};
