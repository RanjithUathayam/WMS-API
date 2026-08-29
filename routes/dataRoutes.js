const express = require('express');
const router = express.Router();
const dataController = require('../controller/dataController');

router.get('/dashboardchart', dataController.dashChartData);
router.get('/rightsList/:id', dataController.rightsList);

module.exports = router;
