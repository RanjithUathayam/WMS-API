const express = require('express');
const router = express.Router();
const projectController = require('../controller/ERPController');

router.post('/getGRNPushingList', projectController.getGRNPushingList)
router.post('/getGRNPushingDetails', projectController.getGRNPushingDetails)
router.post('/createGRNPushingTransaction', projectController.createGRNPushingTransaction)

module.exports = router;
