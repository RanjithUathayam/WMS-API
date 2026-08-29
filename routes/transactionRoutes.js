const express = require('express');
const router = express.Router();
const transactionController = require('../controller/transactionController');

router.get('/inventory', transactionController.inventoryList)

module.exports = router;
