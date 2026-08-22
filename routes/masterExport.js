const express = require('express');
const router = express.Router();
const masterController = require('../controller/masterController');

router.get('/:model/:exportFormat', masterController.ExportMaster);

module.exports = router;
