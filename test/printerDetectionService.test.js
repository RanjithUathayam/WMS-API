const { mapPrinterStatus } = require('../service/printerDetectionService');

describe('printerDetectionService.mapPrinterStatus', () => {
    test('WorkOffline overrides the status code to offline', () => {
        expect(mapPrinterStatus(3, true)).toBe('offline');
        expect(mapPrinterStatus(4, true)).toBe('offline');
    });

    test('maps known Win32_Printer.PrinterStatus codes when online', () => {
        expect(mapPrinterStatus(3, false)).toBe('available');
        expect(mapPrinterStatus(4, false)).toBe('printing');
        expect(mapPrinterStatus(7, false)).toBe('offline');
        expect(mapPrinterStatus(6, false)).toBe('stopped');
    });

    test('unknown codes fall back to "unknown" rather than guessing', () => {
        expect(mapPrinterStatus(999, false)).toBe('unknown');
        expect(mapPrinterStatus(undefined, false)).toBe('unknown');
    });
});
