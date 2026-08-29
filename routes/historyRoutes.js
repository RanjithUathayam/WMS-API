const express = require('express');
const router = express.Router();
const historyController = require('../controller/History/HistoryController');

router.get('/userLog', historyController.userLogList);
router.post('/userEntryLog', historyController.userEntryLogList);
router.post('/insertUserEntryLog', historyController.insertUserEntryLog);

module.exports = router;
