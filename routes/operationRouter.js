const express = require('express');
const router = express.Router();
const projectController = require('../controller/operationController');

//HHT and PreBinning
router.get('/PreBinningApprove', projectController.PreBinningApprove)
router.post('/PreBinApproveStatus', projectController.PreBinApproveStatus)
router.post('/MoveToPreBinning', projectController.MoveToPreBinning)

// bin wise prebininning reject
router.post('/binWisePreBinningReject', projectController.binWisePreBinningReject)
router.post('/rejectPreBinning', projectController.getPreBinningRejectData)

module.exports = router;
