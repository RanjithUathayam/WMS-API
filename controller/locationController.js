const service = require('../service/locationService');
const { LocationError } = service;

const ERROR_STATUS = {
    MISSING_FIELDS: 400,
    INVALID_WAREHOUSE: 400,
    INVALID_LOCATION: 400,
    INVALID_POSITION_RANGE: 400,
    POSITION_RANGE_TOO_LARGE: 400,
    LOCATION_NOT_FOUND: 404,
    LOCATION_ALREADY_EXISTS: 409,
    LOCATION_NOT_EDITABLE: 409,
    LOCATION_HAS_HISTORY: 409,
    LOCATION_ALREADY_ACTIVE: 409,
    LOCATION_ALREADY_INACTIVE: 409,
    LOCATION_OCCUPIED: 409
};

function logOutcome(req, action, outcome, extra) {
    console.log(JSON.stringify({
        action,
        outcome,
        user: req.user && req.user.UserName,
        timestamp: new Date().toISOString(),
        ...extra
    }));
}

function handleError(res, error) {
    if (error instanceof LocationError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Location error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

const getWarehouses = async (req, res) => {
    try {
        const data = await service.getWarehousesAsync();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getWarehouseStatus = async (req, res) => {
    try {
        const data = await service.getWarehouseStatusAsync(req.params.warehouseCode);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getRows = async (req, res) => {
    try {
        const includeInactive = String(req.query.includeInactive).toLowerCase() === 'true';
        const data = await service.getRowsAsync(req.params.warehouseCode, includeInactive);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getAvailablePositions = async (req, res) => {
    try {
        const data = await service.getAvailablePositionsAsync(req.params.warehouseCode, req.params.rowCode);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const getLocation = async (req, res) => {
    try {
        const data = await service.getLocationAsync(req.params.locationId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return handleError(res, error);
    }
};

const generatePositions = async (req, res) => {
    try {
        const data = await service.generatePositionsAsync(req.body, req.user);
        logOutcome(req, 'GENERATE_POSITIONS', 'SUCCESS', {
            warehouseCode: req.body && req.body.warehouseCode,
            rowCode: req.body && req.body.rowCode,
            createdCount: data.createdCount
        });
        return res.status(201).json({ success: true, message: 'Positions generated successfully', data });
    } catch (error) {
        logOutcome(req, 'GENERATE_POSITIONS', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

const createLocation = async (req, res) => {
    try {
        const data = await service.createLocationAsync(req.body, req.user);
        logOutcome(req, 'CREATE_LOCATION', 'SUCCESS', { locationCode: data.locationCode });
        return res.status(201).json({ success: true, message: 'Location created successfully', data });
    } catch (error) {
        logOutcome(req, 'CREATE_LOCATION', 'REJECTED', { validationCode: error.code });
        return handleError(res, error);
    }
};

const updateLocation = async (req, res) => {
    try {
        const data = await service.updateLocationAsync(req.params.locationId, req.body, req.user);
        logOutcome(req, 'UPDATE_LOCATION', 'SUCCESS', { locationId: req.params.locationId });
        return res.status(200).json({ success: true, message: 'Location updated successfully', data });
    } catch (error) {
        logOutcome(req, 'UPDATE_LOCATION', 'REJECTED', { validationCode: error.code, locationId: req.params.locationId });
        return handleError(res, error);
    }
};

const activateLocation = async (req, res) => {
    try {
        const data = await service.setLocationActiveAsync(req.params.locationId, true, req.user);
        logOutcome(req, 'ACTIVATE_LOCATION', 'SUCCESS', { locationId: req.params.locationId });
        return res.status(200).json({ success: true, message: 'Location activated successfully', data });
    } catch (error) {
        logOutcome(req, 'ACTIVATE_LOCATION', 'REJECTED', { validationCode: error.code, locationId: req.params.locationId });
        return handleError(res, error);
    }
};

const deactivateLocation = async (req, res) => {
    try {
        const data = await service.setLocationActiveAsync(req.params.locationId, false, req.user);
        logOutcome(req, 'DEACTIVATE_LOCATION', 'SUCCESS', { locationId: req.params.locationId });
        return res.status(200).json({ success: true, message: 'Location deactivated successfully', data });
    } catch (error) {
        logOutcome(req, 'DEACTIVATE_LOCATION', 'REJECTED', { validationCode: error.code, locationId: req.params.locationId });
        return handleError(res, error);
    }
};

module.exports = {
    getWarehouses,
    getWarehouseStatus,
    getRows,
    getAvailablePositions,
    generatePositions,
    getLocation,
    createLocation,
    updateLocation,
    activateLocation,
    deactivateLocation
};
