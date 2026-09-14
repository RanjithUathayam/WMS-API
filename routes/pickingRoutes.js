const express = require('express');
const router = express.Router();
const pickingController = require('../controller/pickingController');

router.post('/pick/pallet', pickingController.scanPallet);
router.post('/pick/box', pickingController.scanBox);
router.post('/pick/complete', pickingController.completePicking);

module.exports = router;
