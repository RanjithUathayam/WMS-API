const express = require('express');
const router = express.Router();
const inventoryController = require('../controller/inventoryController');

router.get('/summary', inventoryController.getSummary);
router.get('/location/:locationId', inventoryController.getByLocation);
router.get('/pallet/:palletId', inventoryController.getByPallet);
router.get('/list', inventoryController.getList);

module.exports = router;
