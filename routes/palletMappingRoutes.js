const express = require('express');
const router = express.Router();
const palletMappingController = require('../controller/palletMappingController');

router.get('/pallet/:palletId/validate', palletMappingController.validatePallet);
router.get('/pallet/:palletId', palletMappingController.getPalletMapping);
router.get('/box/:boxNumber/validate', palletMappingController.validateBox);
router.post('/box', palletMappingController.addBoxToPallet);
router.post('/complete', palletMappingController.completePallet);

module.exports = router;
