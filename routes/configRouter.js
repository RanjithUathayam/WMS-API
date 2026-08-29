const express = require('express');
const router = express.Router();
const configController = require('../controller/configController');

router.post('/getPickStationData', configController.getPickStationData)

module.exports = router;
