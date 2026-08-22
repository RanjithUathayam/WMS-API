const express = require('express');
const router = express.Router();
const statusController = require('../controller/statusController');

router.post('/craneStatus', statusController.craneStatus);
router.post('/locationStatus', statusController.locationStatus);
router.post('/equipmentStatus', statusController.equipmentStatus);
router.post('/getLocationDetails', statusController.getLocationDetails);
router.post('/getLocationManualBinList', statusController.getLocationManualBinList);
router.post('/getLocationManualEntry', statusController.getLocationManualEntry);
router.post('/updateEmergencyScreenData', statusController.updateEmergencyScreenData);
router.post('/updateEmergencyStationStart', statusController.updateEmergencyStationStart);
router.post('/locationMaintenance', statusController.locationMaintenance);
router.post('/updateLocationMaintenance', statusController.updateLocationMaintenance);

router.post('/updateEmergencySemiautoCommand', statusController.updateEmergencySemiautoCommand);
router.post('/getWCSAlarmData', statusController.getWCSAlarmData);
router.post('/dataCancelProcess', statusController.dataCancelProcess);
router.post('/BinPresent', statusController.BinPresent);
router.post('/dataCancelFreeLocation', statusController.dataCancelFreeLocation);
router.post('/getAutoPalletData', statusController.getAutoPalletData)
router.post('/getLoadStationBuffer', statusController.getLoadStationBuffer);
router.post('/getUnloadStationBuffer', statusController.getUnLoadStationBuffer);
router.post('/getLiftReachedBin', statusController.getLiftReachedBin);
router.post('/getLoadConveyorBuffer', statusController.getLoadConveyorBuffer);
router.post('/getWCSMLSSend', statusController.getWCSMLSSend);
router.post('/getWCSTLSend', statusController.getWCSTLSend);
router.post('/getGroundConveyor', statusController.getGroundConveyor);

router.get('/wcsAlarmReset', statusController.wcsAlarmReset)

router.post('/getMLSAutocmdData', statusController.getMLSAutocmdData);
router.post('/getMLSError', statusController.getMLSError);
router.post('/getTLAutocmdData', statusController.getTLAutocmdData);
router.post('/getTLError', statusController.getTLError);
router.post('/getMLSSemiAutoCmd', statusController.getMLSSemiAutoCmd);
router.post('/getTLSemiAutoCmd', statusController.getTLSemiAutoCmd);
router.post('/getWCSSendModbus', statusController.getWCSSendModbus);


router.post('/getEquipmentRequest', statusController.getEquipmentRequest);
router.post('/getCraneMovement', statusController.getCraneMovement);

// router.post('/w')
module.exports = router;