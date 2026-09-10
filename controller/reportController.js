const service = require('../service/reportService');
const { ReportError } = service;
const { exportData } = require('../models/Export');

const ERROR_STATUS = {
    INVALID_SORT_COLUMN: 400
};

function handleError(res, error) {
    if (error instanceof ReportError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    console.error('Report error:', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

/** Builds one GET handler: JSON page by default, or a file stream when ?exportFormat=csv|excel|pdf is present. */
function makeReportHandler(reportName, getPageAsync, getExportAsync) {
    return async (req, res) => {
        try {
            if (req.query.exportFormat) {
                const { rows, columns } = await getExportAsync(req.query);
                await exportData(res, req.query.exportFormat, reportName, JSON.stringify(columns), rows);
                return;
            }
            const { data, pagination, totals } = await getPageAsync(req.query);
            return res.status(200).json({ success: true, data, pagination, totals });
        } catch (error) {
            return handleError(res, error);
        }
    };
}

module.exports = {
    getPreBinningReport: makeReportHandler('Pre-Binning Report', service.getPreBinningReportAsync, service.getPreBinningReportExportAsync),
    getPalletMappingReport: makeReportHandler('Pallet Mapping Report', service.getPalletMappingReportAsync, service.getPalletMappingReportExportAsync),
    getLocationMappingReport: makeReportHandler('Location Mapping Report', service.getLocationMappingReportAsync, service.getLocationMappingReportExportAsync),
    getInventoryDetailsReport: makeReportHandler('Inventory Details Report', service.getInventoryDetailsReportAsync, service.getInventoryDetailsReportExportAsync)
};
