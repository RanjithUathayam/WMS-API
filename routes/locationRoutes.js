const express = require('express');
const router = express.Router();
const locationController = require('../controller/locationController');

router.get('/warehouses', locationController.getWarehouses);
router.get('/warehouses/:warehouseCode/status', locationController.getWarehouseStatus);
router.get('/warehouse/:warehouseCode/rows', locationController.getRows);
router.get('/warehouse/:warehouseCode/row/:rowCode/positions', locationController.getAvailablePositions);
router.post('/positions/generate', locationController.generatePositions);
router.get('/details/:locationId', locationController.getLocation);
router.post('/create', locationController.createLocation);
router.put('/details/:locationId', locationController.updateLocation);
router.patch('/activate/:locationId', locationController.activateLocation);
router.patch('/deactivate/:locationId', locationController.deactivateLocation);

module.exports = router;
