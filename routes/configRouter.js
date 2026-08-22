const express = require('express');
const router = express.Router();
const configController = require('../controller/configController');

router.post('/addressDataLoad', configController.addressDataLoad)
router.post('/updateRegisterAddress', configController.updateRegisterAddress)

router.post('/addressDataLoadOpc', configController.addressDataLoadopc)
router.post('/getEquipmentData', configController.getEquipmentData)
router.post('/updateEquipmentData', configController.updateEquipmentData)
router.get('/getEquipmentIPConfigData', configController.getEquipmentIPConfigData)
router.post('/updateEquipmentIPConfigData', configController.updateEquipmentIPConfigData)
router.get('/getStationConfig', configController.getStationConfig)
router.post('/updateStationConfig', configController.updateStationConfig) 
router.post('/getPickStationData', configController.getPickStationData)
router.post('/addAlarmData', configController.addAlarmData)

module.exports = router;
