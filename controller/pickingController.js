const service = require('../service/pickingService');
const { PickingError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_PICKED_QUANTITY: 400,
    PALLET_NOT_FOUND: 404,
    PALLET_NOT_AVAILABLE: 409,
    BOX_NOT_FOUND: 404,
    BOX_NOT_IN_PALLET: 409,
    ITEM_NOT_FOUND: 404,
    BOX_ALREADY_PICKED: 409,
    INSUFFICIENT_INVENTORY: 409
};

function handleError(res, error) {
    if (error instanceof PickingError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Picking error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const scanPallet = async (req, res) => {
    try {
        const data = await service.scanPalletAsync(req.body);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const scanBox = async (req, res) => {
    try {
        const data = await service.scanBoxAsync(req.body);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const completePicking = async (req, res) => {
    try {
        const data = await service.completePickingAsync(req.body, req.user);
        return res.status(201).json({ success: true, message: 'Picking completed successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    scanPallet,
    scanBox,
    completePicking
};
