const express = require('express');
const router = express.Router();
const pickingController = require('../controller/pickingController');

// Source Stock Transfer Requests (SAP B1 OWTQ/WTQ1)
router.get('/stock-transfer-requests', pickingController.getStockTransferRequests);

// Pick List
router.get('/picklist', pickingController.listPickLists);
router.post('/picklist', pickingController.createPickList);
router.get('/picklist/:pickListId', pickingController.getPickList);
router.get('/picklist/:pickListId/inventory', pickingController.getPickListInventory);
router.post('/picklist/:pickListId/complete', pickingController.completePickList);

// Picking (pallet/box scan + save pick). /pick/pallet and /pick/box without pickListId keep the original behaviour.
router.post('/pick/pallet', pickingController.scanPallet);
router.post('/pick/box', pickingController.scanBox);
router.post('/pick/complete', pickingController.completePicking);
router.post('/pick', pickingController.savePick);

module.exports = router;
