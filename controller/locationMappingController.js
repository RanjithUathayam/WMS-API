const service = require('../service/locationMappingService');
const { LocationMappingError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_PALLET_ID: 400,
    PALLET_NOT_FOUND: 404,
    LOCATION_NOT_FOUND: 404,
    LOCATION_MAPPING_NOT_FOUND: 404,
    LOCATION_MISMATCH: 400,
    LOCATION_NOT_AVAILABLE: 409,
    LOCATION_BLOCKED: 409,
    LOCATION_INACTIVE: 409,
    PALLET_MAPPING_NOT_COMPLETED: 409,
    PALLET_ALREADY_MAPPED: 409,
    PALLET_EMPTY: 400,
    PALLET_WAREHOUSE_MISMATCH: 409,
    LOCATION_MAPPING_CONFLICT: 409
};

function logOutcome(req, action, outcome, extra) {
    console.log(JSON.stringify({
        action,
        outcome,
        user: req.user && req.user.UserName,
        palletId: req.body ? req.body.palletId : (req.params ? req.params.palletId : undefined),
        timestamp: new Date().toISOString(),
        ...extra
    }));
}

function handleError(res, error) {
    if (error instanceof LocationMappingError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Location Mapping error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const validatePallet = async (req, res) => {
    try {
        const data = await service.validatePalletForLocationMappingAsync(req.params.palletId);
        return res.status(200).json({ success: true, message: 'Pallet validated successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getMappingByPallet = async (req, res) => {
    try {
        const data = await service.getMappingByPalletIdAsync(req.params.palletId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const mapPalletToLocation = async (req, res) => {
    try {
        const data = await service.mapPalletToLocationAsync(req.body, req.user);
        logOutcome(req, 'MAP_LOCATION', 'SUCCESS', { locationCode: data.locationCode, idempotent: data.idempotent });
        return res.status(200).json({ success: true, message: 'Pallet mapped to location successfully', data });
    } catch (error) {
        logOutcome(req, 'MAP_LOCATION', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

module.exports = {
    validatePallet,
    getMappingByPallet,
    mapPalletToLocation
};
