const express = require('express');
const router = express.Router();
const locationMappingController = require('../controller/locationMappingController');

router.post('/map', locationMappingController.mapPalletToLocation);

module.exports = router;
