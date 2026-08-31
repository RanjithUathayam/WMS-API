const express = require('express');
const router = express.Router();
const palletMappingController = require('../controller/palletMappingController');

router.post('/pallet/validate', palletMappingController.validatePallet);
router.get('/pallet/:palletId', palletMappingController.getPalletMapping);
router.post('/box', palletMappingController.addBox);
router.post('/complete', palletMappingController.completePallet);

module.exports = router;
