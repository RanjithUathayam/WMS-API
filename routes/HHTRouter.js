const express = require('express');
const router = express.Router();
const projectController = require('../controller/HHTController');

router.post('/getGRNDetails', projectController.getGRNDetails)
router.post('/giveDeviceRights', projectController.giveDeviceRights)
router.get('/getDeveiceDetails', projectController.getDevices)

module.exports = router;
