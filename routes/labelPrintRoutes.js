const express = require('express');
const router = express.Router();
const labelPrintController = require('../controller/labelPrintController');

/*
    URL shapes deviate slightly from the prompt's literal `/{printJobId}/print` and
    `/{printJobId}/retry` — this app's global permission middleware (authenticateToken.js:
    checkPermission) authorizes a request by matching the FIRST path segment after the router's
    mount point against a static list (see the "Label Print" block added to moduleNames there).
    A numeric printJobId as the first segment could never match, so it's kept after a fixed literal
    word instead (same approach preBinningRoutes.js uses for /box/validate, /box/complete, etc.).
    GET /job/:printJobId/preview keeps 'job' first on purpose, reusing the same permission entry as
    POST /job.
*/
router.get('/config', labelPrintController.getConfig);
router.post('/job', labelPrintController.createJob);
router.get('/job/:printJobId/preview', labelPrintController.preview);
router.post('/print/:printJobId', labelPrintController.printJob);
router.post('/retry/:printJobId', labelPrintController.retryJob);

module.exports = router;
