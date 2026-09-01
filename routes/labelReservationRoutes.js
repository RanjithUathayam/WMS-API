const express = require('express');
const router = express.Router();
const labelReservationController = require('../controller/labelReservationController');

// Mounted at /api/label (app.js) — resolves to exactly POST /api/label/reserveLabelNumbers and
// POST /api/label/print, matching the frontend's existing call. Do not rename these segments
// without also updating the frontend's API call.
router.post('/reserveLabelNumbers', labelReservationController.reserveLabelNumbers);
router.post('/print', labelReservationController.printLabels);
router.post('/print/confirm', labelReservationController.confirmPrint);
router.get('/printers', labelReservationController.listPrinters);
router.post('/printers/detect', labelReservationController.detectPrinters);

module.exports = router;
