const service = require('../service/locationMappingService');
const { LocationMappingError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    LOCATION_NOT_FOUND: 404,
    LOCATION_MISMATCH: 400,
    LOCATION_NOT_AVAILABLE: 409,
    LOCATION_ALREADY_OCCUPIED: 409,
    PALLET_NOT_FOUND: 404,
    PALLET_NOT_COMPLETED: 409,
    PALLET_ALREADY_MAPPED: 409
};

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

const mapPalletToLocation = async (req, res) => {
    try {
        const data = await service.mapPalletToLocationAsync(req.body, req.user);
        return res.status(201).json({ success: true, message: 'Pallet mapped to location successfully', data });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports = {
    mapPalletToLocation
};
