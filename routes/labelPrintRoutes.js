const express = require('express');
const router = express.Router();
const labelPrintController = require('../controller/labelPrintController');

router.get('/config', labelPrintController.getConfig);

module.exports = router;
