const express = require('express');
const router = express.Router();
const dataController = require('../controller/dataController');

// GET all projects
router.get('/dashboardheader', dataController.marqueeOccupied);
router.get('/dashboardchart', dataController.dashChartData);
router.get('/craneIDs', dataController.craneIDs);
router.get('/itemgroup', dataController.itemGroup);
router.get('/rightsList/:id', dataController.rightsList);

module.exports = router;
