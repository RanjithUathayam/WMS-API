const service = require('../service/palletMappingService');
const { PalletMappingError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    PALLET_NOT_FOUND: 404,
    PALLET_NOT_OPEN: 409,
    PALLET_ALREADY_COMPLETED: 409,
    PALLET_HAS_NO_BOXES: 409,
    BOX_NOT_FOUND: 404,
    BOX_NOT_ELIGIBLE: 409,
    BOX_ALREADY_MAPPED: 409
};

function handleError(res, error) {
    if (error instanceof PalletMappingError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Pallet Mapping error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const validatePallet = async (req, res) => {
    try {
        const data = await service.validatePalletAsync(req.body, req.user);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const addBox = async (req, res) => {
    try {
        const data = await service.addBoxAsync(req.body, req.user);
        return res.status(201).json({ success: true, message: 'Box mapped successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const completePallet = async (req, res) => {
    try {
        const data = await service.completePalletAsync(req.body, req.user);
        return res.status(200).json({ success: true, message: 'Pallet mapping completed successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getPalletMapping = async (req, res) => {
    try {
        const data = await service.getPalletMappingAsync(req.params.palletId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    validatePallet,
    addBox,
    completePallet,
    getPalletMapping
};
