const express = require('express');
const router = express.Router();
const projectController = require('../controller/HHTController');

//Storage Details
router.get('/getPendingGRN', projectController.getPendingGRN)
router.post('/getGRNDetails', projectController.getGRNDetails)
router.post('/binComplete', projectController.binComplete)
router.get('/getGRNStatus', projectController.getGRNStatus)
router.post('/completeItem', projectController.completeItem)
router.post('/getBinDetails', projectController.getBinDetails)
router.post('/giveDeviceRights', projectController.giveDeviceRights)
router.get('/getDeveiceDetails', projectController.getDevices)
router.post('/getBinDetailsForRefilling', projectController.getBinDetailsForRefilling)
router.post('/updateRefilledBin', projectController.updateRefilledBin)
router.post('/updateStock', projectController.updateStock)

module.exports = router;