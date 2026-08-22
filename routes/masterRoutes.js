const express = require('express');
const router = express.Router();
// const uomController = require('../controller/uomController');
const masterController = require('../controller/masterController');

router.get('/:model', masterController.getAll);
router.get('/:model/:id', masterController.getById);
router.post('/:model', masterController.createEntity);
router.put('/:model/:id', masterController.updateEntity);
router.delete('/:model/:id', masterController.deleteEntity);

module.exports = router;
