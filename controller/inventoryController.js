const service = require('../service/inventoryService');
const { InventoryError } = service;

const ERROR_STATUS = {
    INVALID_LOCATION: 400,
    INVALID_PALLET_ID: 400,
    PALLET_NOT_FOUND: 404
};

function handleError(res, error) {
    if (error instanceof InventoryError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Inventory error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const getSummary = async (req, res) => {
    try {
        const data = await service.getSummaryAsync(req.query);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getList = async (req, res) => {
    try {
        const data = await service.getListAsync(req.query);
        return res.status(200).json({ success: true, data: data.items, page: data.page, pageSize: data.pageSize, total: data.total });
    } catch (error) {
        return handleError(res, error);
    }
};

const getByLocation = async (req, res) => {
    try {
        const data = await service.getByLocationAsync(req.params.locationId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getByPallet = async (req, res) => {
    try {
        const data = await service.getByPalletAsync(req.params.palletId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    getSummary,
    getList,
    getByLocation,
    getByPallet
};
