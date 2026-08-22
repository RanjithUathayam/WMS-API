const express = require('express');
const router = express.Router();
const transactionController = require('../controller/transactionController');
//Storage Details
router.get('/binRequest', transactionController.palletRequestList)
router.get('/toteliftRequest', transactionController.toteliftRequestList)
router.get('/item' ,transactionController.itemInventoryList)
router.get('/itemfilter', transactionController.getFilters)
router.get('/inventory', transactionController.inventoryList)

router.post('/getERPConfirmation', transactionController.getERPConfirmation)
router.post('/getStoreRetrieveSummary', transactionController.getStoreRetrieveSummary)

router.get('/getOrderProcessingSummary', transactionController.getOrderProcessingSummary)

router.get('/getPreBinningSummary', transactionController.getPreBinningSummary)

router.post('/getLiveStationDetails', transactionController.getLiveStationDetails)

router.post('/getStoreRetrieveDashboard', transactionController.getStoreRetrieveDashboard)

module.exports = router;
