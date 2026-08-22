const express = require('express');
const router = express.Router();
const historyController = require('../controller/History/HistoryController');

// History Module
router.get('/searchAlarmHistory', historyController.searchAlarmHistory);
// router.post('/alarmReset', historyController.alarmReset);
router.get('/rejectedHistory', historyController.rejectedHistory);
router.get('/maintenanceHistory', historyController.maintenanceHistory);
router.get('/userLog', historyController.userLogList);
router.get('/expiryAlert', historyController.searchExpiryAlert);
router.get('/expiryAlertFilter', historyController.getExpiryFilters);
router.post('/userEntryLog', historyController.userEntryLogList);
router.post('/insertUserEntryLog', historyController.insertUserEntryLog);

//Storage Details
router.get('/storageExcelUpload', historyController.executeStoredProcedure)
router.get('/loadUnLoad', historyController.loadUnLoadHistory)

//RESET
router.post('/resetAlarm', historyController.resetAlarm)

module.exports = router;
