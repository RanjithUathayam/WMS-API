const express = require('express');
const router = express.Router();
const locationMappingController = require('../controller/locationMappingController');

router.get('/pallet/:palletId/validate', locationMappingController.validatePallet);
router.get('/pallet/:palletId', locationMappingController.getMappingByPallet);
router.post('/map', locationMappingController.mapPalletToLocation);

module.exports = router;
