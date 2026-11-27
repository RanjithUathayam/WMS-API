const express = require('express');
const router = express.Router();
const preBinningController = require('../controller/preBinningController');

router.get('/warehouses', preBinningController.getWarehouses);
router.get('/warehouse-stock', preBinningController.getWarehouseStock);
router.post('/box/validate', preBinningController.validateBox);
router.post('/item/scan', preBinningController.scanItem);
router.get('/box/:boxNumber/items', preBinningController.getBoxItems);
router.post('/box/complete', preBinningController.completeBox);
router.post('/box/delete', preBinningController.deleteBox);

module.exports = router;
