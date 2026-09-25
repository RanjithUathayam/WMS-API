const service = require('../service/pickingService');
const inventoryService = require('../service/pickingInventoryService');
const { PickingError } = require('../service/pickingCommon');

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_REQUEST: 400,
    INVALID_DOCUMENT: 400,
    TOO_MANY_DOCUMENTS: 400,
    INVALID_PICKED_QUANTITY: 400,
    INVALID_PICK_QTY: 400,
    PALLET_NOT_FOUND: 404,
    PALLET_NOT_AVAILABLE: 409,
    PALLET_NOT_APPLICABLE: 409,
    BOX_NOT_FOUND: 404,
    BOX_NOT_IN_PALLET: 409,
    BOX_NOT_APPLICABLE: 409,
    ITEM_NOT_FOUND: 404,
    BOX_ALREADY_PICKED: 409,
    INSUFFICIENT_INVENTORY: 409,
    INSUFFICIENT_STOCK: 409,
    DOCUMENT_NOT_FOUND: 404,
    DOCUMENT_CLOSED: 409,
    NO_OPEN_LINES: 409,
    DUPLICATE_PICKLIST: 409,
    PICKLIST_BUSY: 409,
    PICKLIST_NOT_FOUND: 404,
    PICKLIST_CLOSED: 409,
    PICKLIST_CANCELLED: 409,
    PICKLIST_PROCESSING: 409,
    ITEM_NOT_IN_PICKLIST: 409,
    LINE_ALREADY_PICKED: 409,
    PICK_QTY_EXCEEDS_REMAINING: 409,
    WAREHOUSE_MISMATCH: 409,
    LOCATION_MISMATCH: 409,
    PICKING_INCOMPLETE: 409,
    PICK_AUDIT_MISMATCH: 409,
    DC_NOT_ALLOWED: 409,
    STOCK_TRANSFER_NOT_ALLOWED: 409,
    DC_GENERATION_FAILED: 500,
    SAP_STOCK_TRANSFER_FAILED: 502
};

function handleError(res, error) {
    if (error instanceof PickingError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            message: error.message,
            errorCode: error.code,
            code: error.code, // legacy alias read by the existing Picking screen
            data: error.data || null
        });
    }
    console.error('Picking error:', error);
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

function hasPickList(body) {
    return body && body.pickListId !== undefined && body.pickListId !== null && body.pickListId !== '';
}

const getStockTransferRequests = handle(req => service.getStockTransferRequestLinesAsync(req.query), 'Stock Transfer Request lines');

const createPickList = handle(req => service.createPickListAsync(req.body, req.user),
    data => `Pick List ${data.pickListNumber} created successfully`, 201);

const listPickLists = handle(req => service.listPickListsAsync(req.query), 'Pick Lists');

const getPickList = handle(req => service.getPickListAsync(req.params.pickListId), 'Pick List');

const getPickListInventory = handle(req => inventoryService.getPickListInventoryAsync(req.params.pickListId), 'Available inventory');

/** With pickListId: Pick List scan. Without: the original pallet-only scan used by the existing Picking screen. */
const scanPallet = handle(req => hasPickList(req.body)
    ? inventoryService.scanPalletForPickListAsync(req.body)
    : service.scanPalletAsync(req.body), 'Pallet validated');

const scanBox = handle(req => hasPickList(req.body)
    ? inventoryService.scanBoxForPickListAsync(req.body)
    : service.scanBoxAsync(req.body), 'Box validated');

const savePick = handle(req => service.savePickTransactionAsync(req.body, req.user),
    data => (data.duplicate ? 'Pick transaction already saved' : 'Pick transaction saved successfully'), 201);

const completePickList = handle(req => service.completePickListAsync(req.params.pickListId, req.user),
    data => (data.alreadyCompleted ? `Pick List ${data.pickListNumber} was already completed` : `Pick List ${data.pickListNumber} completed successfully`));

/** Legacy: POST /pick/complete — pallet picking without a Pick List. */
const completePicking = handle(req => service.completePickingAsync(req.body, req.user), 'Picking completed successfully', 201);

module.exports = {
    getStockTransferRequests,
    createPickList,
    listPickLists,
    getPickList,
    getPickListInventory,
    scanPallet,
    scanBox,
    savePick,
    completePickList,
    completePicking
};
