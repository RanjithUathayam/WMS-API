const express = require('express');
const router = express.Router();
const rackController = require('../controller/rackController');

// Rack Management (Rack Store / Rack Picking). Each route has its own literal first path segment
// because authenticateToken.js's checkPermission() resolves rights by first segment only.
router.get('/rackwarehouses', rackController.getWarehouses);
router.post('/rackscan', rackController.scanRack);
router.post('/rackitem', rackController.scanItem);
router.post('/racksave', rackController.save);
router.get('/rackhistory', rackController.listHistory);
router.get('/rackhistory/:transactionId', rackController.getHistory);

module.exports = router;
