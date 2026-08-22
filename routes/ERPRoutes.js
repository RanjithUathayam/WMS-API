const express = require('express');
const router = express.Router();
const projectController = require('../controller/ERPController');

//Storage Details
router.post('/ERPLogin', projectController.ERPLoginVerify)
router.post('/createERPItemMaster', projectController.createERPItemMaster)
router.post('/createERPBinMaster', projectController.createERPBinMaster)
router.post('/createERPPreBinning', projectController.createERPPreBinning)
router.post('/createERPRetrieval', projectController.createERPRetrieval)
router.post('/createERPStockAdjustment', projectController.createERPStockAdjustment)
router.post('/nextTrolley', projectController.nextTrolley)
router.post('/getTrolleyReprint', projectController.getTrolleyReprint)
router.post('/getPendingTrolleyData', projectController.getPendingTrolleyData)
router.get('/getInventoryData', projectController.getInventoryData)
router.post('/getGRNPushingList', projectController.getGRNPushingList)
router.post('/getGRNPushingDetails', projectController.getGRNPushingDetails)
router.post('/createGRNPushingTransaction', projectController.createGRNPushingTransaction)

module.exports = router;
