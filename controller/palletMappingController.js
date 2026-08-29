const service = require('../service/palletMappingService');
const { PalletMappingError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_PALLET_ID: 400,
    INVALID_BOX_NUMBER: 400,
    PALLET_NOT_FOUND: 404,
    PALLET_ALREADY_COMPLETED: 409,
    PALLET_EMPTY: 400,
    BOX_NOT_FOUND: 404,
    BOX_NOT_ELIGIBLE: 409,
    BOX_ALREADY_MAPPED: 409
};

function logOutcome(req, action, outcome, extra) {
    console.log(JSON.stringify({
        action,
        outcome,
        user: req.user && req.user.UserName,
        palletId: req.body ? req.body.palletId : (req.params ? req.params.palletId : undefined),
        boxNumber: req.body ? req.body.boxNumber : (req.params ? req.params.boxNumber : undefined),
        timestamp: new Date().toISOString(),
        ...extra
    }));
}

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
        const data = await service.validatePalletAsync({ palletId: req.params.palletId });
        return res.status(200).json({ success: true, message: 'Pallet validated successfully', data });
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

const validateBox = async (req, res) => {
    try {
        const data = await service.validateBoxAsync({ boxNumber: req.params.boxNumber });
        return res.status(200).json({ success: true, message: 'Box validated successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const addBoxToPallet = async (req, res) => {
    try {
        const data = await service.addBoxToPalletAsync(req.body, req.user);
        logOutcome(req, 'MAP_BOX', 'SUCCESS');
        return res.status(200).json({ success: true, message: 'Box mapped to pallet successfully', data });
    } catch (error) {
        logOutcome(req, 'MAP_BOX', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

const completePallet = async (req, res) => {
    try {
        const data = await service.completePalletAsync(req.body, req.user);
        logOutcome(req, 'COMPLETE_PALLET', 'SUCCESS');
        return res.status(200).json({ success: true, message: 'Pallet completed successfully', data });
    } catch (error) {
        logOutcome(req, 'COMPLETE_PALLET', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

module.exports = {
    validatePallet,
    getPalletMapping,
    validateBox,
    addBoxToPallet,
    completePallet
};
