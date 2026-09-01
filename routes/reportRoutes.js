const express = require('express');
const router = express.Router();
const reportController = require('../controller/reportController');

router.get('/prebinning', reportController.getPreBinningReport);
router.get('/palletmapping', reportController.getPalletMappingReport);
router.get('/locationmapping', reportController.getLocationMappingReport);
router.get('/inventorydetails', reportController.getInventoryDetailsReport);

module.exports = router;
