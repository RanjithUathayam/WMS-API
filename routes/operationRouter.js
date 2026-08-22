const express = require('express');
const router = express.Router();
const projectController = require('../controller/operationController');

//Storage Details
router.post('/storageExcelUpload', projectController.storageUploadData)
router.post('/getStorageDetailsData', projectController.getStorageDetailsData)
router.get('/binRequestPageData', projectController.palletRequestPageData)
router.post('/addNewBinStore', projectController.addPalletNewItem)
router.post('/binRequestList', projectController.palletRequestList)
router.get('/retrievalPageData', projectController.retrievalPageData)
//Relocation
router.post('/relocationFromSideData', projectController.relocationFromSideData)
router.post('/relocationToSideData', projectController.relocationToSideData)
router.post('/palletRelocate', projectController.palletRelocate)

//HHT and PreBinning
router.get('/PreBinningApprove', projectController.PreBinningApprove)
router.post('/PreBinApproveStatus', projectController.PreBinApproveStatus)
router.post('/MoveToPreBinning', projectController.MoveToPreBinning)

//Retrieval
router.get('/getERPRetrievalData', projectController.getERPRetrievalData)

// router.post('/addPalletRequest', projectController.addPalletRequest)
//EmptyBin
router.post('/EmptyBinStore', projectController.EmptyBinStore)
router.post('/EmptyBinPageData', projectController.EmptyBinPageData)
router.post('/getEmptyBinCount',projectController.getEmptyBinCount)
router.post('/emptyBinRequest', projectController.emptyBinRequest)

router.post('/pickingId', projectController.pickingRequestID)
router.post('/pickingApproval', projectController.pickingApproval)
router.get('/tvDisplay', projectController.tvDisplay)
router.get('/ScheduleQueueRequest', projectController.ScheduleQueueRequest)

//StockAdjustment
router.get('/stockAdjustmentBin', projectController.stockAdjustmentList);
router.post('/updateStockAdjustment', projectController.stockAdjustmentUpdate);
router.post('/stockAdjustmentBinRequest', projectController.stockAdjustmentBinRequest);

//QueueList
router.post('/updateRetriveQueueList', projectController.updateRetriveQueueList);
router.post('/updateScheduleQueueList', projectController.updateScheduleQueueList)

//consolidationBinPageData
router.post('/consolidationBinPageData', projectController.consolidationBinPageData)
router.post('/consolidationBinRetrieval', projectController.consolidationBinRetrieval)

//RetrivalQueueMoveToPicking
router.post('/retrievalQueueMoveToPicking', projectController.retrievalQueueMoveToPicking)

//OrderwiseBinSummary
router.get('/orderwiseBinSummary', projectController.orderwiseBinSummary)
router.post('/binMoveConfirm', projectController.binMoveConfirm)
router.post('/binMoveRetry', projectController.binMoveRetry)

//BinRetrievalData
router.post('/getBinRetrievalData', projectController.getBinRetrievalData)
router.post('/unloadBin', projectController.unloadBin)

router.post('/getOrderApproval', projectController.getOrderApproval)

router.post('/getRetrievalOrderData', projectController.getRetrievalOrderData)
router.post('/getRetrievalOrderDetails', projectController.getRetrievalOrderDetails)
router.post('/retrievalOrderStart', projectController.retrievalOrderStart)
router.post('/orderReExecute', projectController.orderReExecute)
router.post('/retrievalOrderHold', projectController.retrievalOrderHold)
router.post('/RetrievalOrderDetails', projectController.RetrievalOrderDetails)
router.post('/getPickingOrderBinDetails', projectController.getPickingOrderBinDetails)

// bin wise prebininning reject
router.post('/binWisePreBinningReject', projectController.binWisePreBinningReject)
router.post('/rejectPreBinning', projectController.getPreBinningRejectData)
router.post('/getRetrieveReAssign', projectController.getRetrieveReAssign)

router.post('/getPickingOrderDetails', projectController.getPickingOrderDetails)
 
module.exports = router;