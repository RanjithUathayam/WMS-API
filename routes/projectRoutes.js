const express = require('express');
const router = express.Router();
const projectController = require('../controller/projectController');

router.post('/login', projectController.loginVerify)
router.post('/logout', projectController.logout)
router.post('/changePassword', projectController.changePassword)

module.exports = router;
