jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/labelPrintRepository');
jest.mock('../repository/labelReservationRepository');
jest.mock('../service/printerDetectionService');

const sequenceRepository = require('../repository/labelPrintRepository');
const repository = require('../repository/labelReservationRepository');
const printerDetection = require('../service/printerDetectionService');
const service = require('../service/labelReservationService');
const { LabelReservationError } = service;

const ONLINE_PRINTER = { name: 'TSC TE210', status: 'available', isDefault: true };

function reservationRow(labelNumber, status = 'Reserved') {
    return { LabelNumber: labelNumber, QRValue: labelNumber, Status: status };
}

beforeEach(() => {
    jest.clearAllMocks();
    sequenceRepository.reserveLabelNumbers.mockResolvedValue({ start: 1, end: 5 });
    sequenceRepository.getActivePrinterConfig.mockResolvedValue({ PrinterName: 'TSC TE210', Density: 10, Speed: 2 });
    sequenceRepository.getPrinterCapabilityByName.mockResolvedValue(null);
    sequenceRepository.getActiveTemplate.mockResolvedValue(null);
    sequenceRepository.upsertPrinterLastUsedSettings.mockResolvedValue();
    printerDetection.detectPrinters.mockResolvedValue([ONLINE_PRINTER]);
    printerDetection.sendRawToPrinterAsync.mockResolvedValue();
    printerDetection.PrinterDetectionError = class PrinterDetectionError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    };
});

describe('reserveLabelNumbersAsync — validation (Test 5, 6)', () => {
    test('rejects labelCount = 0 with HTTP-400-shaped error', async () => {
        await expect(service.reserveLabelNumbersAsync({ labelCount: 0 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects labelCount = -1', async () => {
        await expect(service.reserveLabelNumbersAsync({ labelCount: -1 }))
            .rejects.toBeInstanceOf(LabelReservationError);
    });

    test('rejects non-integer labelCount', async () => {
        await expect(service.reserveLabelNumbersAsync({ labelCount: 2.5 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects labelCount beyond the configured maximum', async () => {
        await expect(service.reserveLabelNumbersAsync({ labelCount: 100000 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('reserveLabelNumbersAsync — success (Test 1)', () => {
    test('reserves labelCount unique numbers with qrValue === labelNumber', async () => {
        repository.insertReservation
            .mockResolvedValueOnce({ LabelNumber: '202608260001', QRValue: '202608260001' })
            .mockResolvedValueOnce({ LabelNumber: '202608260002', QRValue: '202608260002' });

        const result = await service.reserveLabelNumbersAsync({ labelCount: 2 });

        expect(result.success).toBe(true);
        expect(result.labelCount).toBe(2);
        expect(result.labels).toHaveLength(2);
        result.labels.forEach(l => expect(l.qrValue).toBe(l.labelNumber));
    });
});

describe('printLabelsAsync — validation (Test 11, 12)', () => {
    test('rejects density outside 1-15', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, density: 16 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, density: 0 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects speed outside 1-4', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, speed: 5 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, speed: 0 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects a non-numeric gapMm', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, gapMm: 'wide' }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects a non-numeric offsetMm but allows negative values', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, offsetMm: 'left' }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, offsetMm: -2 });
        // no throw => negative offsetMm accepted
    });

    test('rejects an invalid mfgDate', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, mfgDate: 'not-a-date' }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects an empty labelNumbers array', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: [], copies: 1 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects duplicate label numbers in one request', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001', '202608260001'], copies: 1 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('printLabelsAsync — printer resolution (Test 13)', () => {
    test('rejects an invalid/undetected printer name', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, printerName: 'Nonexistent Printer' }))
            .rejects.toMatchObject({ code: 'PRINTER_NOT_FOUND' });
    });

    test('rejects a detected-but-offline printer before ever attempting to send', async () => {
        printerDetection.detectPrinters.mockResolvedValue([{ name: 'TSC TE210', status: 'offline', isDefault: true }]);
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 }))
            .rejects.toMatchObject({ code: 'PRINTER_OFFLINE' });
        expect(printerDetection.sendRawToPrinterAsync).not.toHaveBeenCalled();
    });
});

describe('printLabelsAsync — reservation checks (existing /reserveLabelNumbers workflow, Test 16)', () => {
    test('rejects Label Numbers that were never reserved (no arbitrary numbers accepted)', async () => {
        repository.lockReservationsByLabelNumbers.mockResolvedValue([]); // nothing found
        await expect(service.printLabelsAsync({ labelNumbers: ['202608269999'], copies: 1 }))
            .rejects.toMatchObject({ code: 'LABEL_NUMBERS_NOT_FOUND' });
    });

    test('rejects a Label Number that is already Printed', async () => {
        repository.lockReservationsByLabelNumbers.mockResolvedValue([reservationRow('202608260001', 'Printed')]);
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 }))
            .rejects.toMatchObject({ code: 'LABEL_NOT_PRINTABLE' });
    });

    test('allows retrying a Failed Label Number without a new Label Number', async () => {
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001', 'Failed')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        const result = await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 });
        expect(result.success).toBe(true);
        expect(result.data.labels[0].labelNumber).toBe('202608260001');
    });
});

describe('printLabelsAsync — success (Test 14)', () => {
    test('prints reserved labels, applies settings to the command, and reports totalPhysicalPrints', async () => {
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001'), reservationRow('202608260002')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed'), reservationRow('202608260002', 'Printed')]);

        const result = await service.printLabelsAsync({
            labelNumbers: ['202608260001', '202608260002'],
            copies: 3,
            density: 12,
            speed: 3,
            gapMm: 3,
            offsetMm: 0
        });

        expect(result.success).toBe(true);
        expect(result.data.labelCount).toBe(2);
        expect(result.data.totalPhysicalPrints).toBe(6); // 2 labels x 3 copies
        expect(result.data.density).toBe(12);
        expect(result.data.speed).toBe(3);
        expect(result.data.command).toContain('DENSITY 12');
        expect(result.data.command).toContain('SPEED 3');
        expect(printerDetection.sendRawToPrinterAsync).toHaveBeenCalledWith('TSC TE210', expect.any(String));
    });
});

describe('printLabelsAsync — printable area respects the brand/hologram section split', () => {
    test('uses the active template\'s Brand/CenterSectionWidth to position content, not the raw label edge', async () => {
        sequenceRepository.getActiveTemplate.mockResolvedValue({ BrandSectionWidth: 37, CenterSectionWidth: 53, HologramSectionWidth: 10 });
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        const result = await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 });

        expect(result.data.printableXMm).toBeCloseTo(0.37 * 90, 5);
        expect(result.data.printableWidthMm).toBeCloseTo(0.53 * 90, 5);
        expect(result.data.command).not.toContain('QRCODE 32,32,'); // old hard-coded position, inside the brand section
    });

    test('falls back to the whole label as printable when no template is configured', async () => {
        sequenceRepository.getActiveTemplate.mockResolvedValue(null);
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        const result = await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 });
        expect(result.data.command).toContain('QRCODE 32,32,');
    });

    test('surfaces PRINTABLE_AREA_EXCEEDED (not a generic failure) when content cannot fit, and marks the label Failed', async () => {
        sequenceRepository.getActiveTemplate.mockResolvedValue({ BrandSectionWidth: 90, CenterSectionWidth: 2, HologramSectionWidth: 8 });
        repository.lockReservationsByLabelNumbers.mockResolvedValue([reservationRow('202608260001')]);

        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 }))
            .rejects.toMatchObject({ code: 'PRINTABLE_AREA_EXCEEDED' });

        expect(repository.updateReservationsStatus).toHaveBeenCalledWith(
            expect.anything(), ['202608260001'], 'Failed', expect.objectContaining({ failedAt: true })
        );
        expect(printerDetection.sendRawToPrinterAsync).not.toHaveBeenCalled();
    });
});

describe('printLabelsAsync — DPI and rotation (spec sections 4, 5, 10)', () => {
    test('DPI comes from the printer profile, not a hard-coded/guessed value', async () => {
        sequenceRepository.getPrinterCapabilityByName.mockResolvedValue({ DPI: 300, MinDensity: 1, MaxDensity: 15, MinSpeed: 1, MaxSpeed: 4, SupportsGap: true, SupportsOffset: true, Density: 10, Speed: 2, GapMm: 3, OffsetMm: 0 });
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        const result = await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 });
        expect(result.data.dpi).toBe(300);
    });

    test('rejects an out-of-range dpi override', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, dpi: 50 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects a rotation value other than 0/90/180/270', async () => {
        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, rotation: 45 }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('accepts and applies a valid rotation', async () => {
        repository.lockReservationsByLabelNumbers
            .mockResolvedValueOnce([reservationRow('202608260001')])
            .mockResolvedValueOnce([reservationRow('202608260001', 'Printed')]);

        const result = await service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1, rotation: 180 });
        expect(result.data.rotation).toBe(180);
        expect(result.data.command).toContain(',180,');
    });
});

describe('printLabelsAsync — print service failure (Test 15)', () => {
    test('marks labels Failed and surfaces PRINT_FAILED without a raw stack trace', async () => {
        repository.lockReservationsByLabelNumbers.mockResolvedValue([reservationRow('202608260001')]);
        printerDetection.sendRawToPrinterAsync.mockRejectedValue(
            new printerDetection.PrinterDetectionError('PRINT_FAILED', 'The printer did not accept the print job.')
        );

        await expect(service.printLabelsAsync({ labelNumbers: ['202608260001'], copies: 1 }))
            .rejects.toMatchObject({ code: 'PRINT_FAILED' });

        expect(repository.updateReservationsStatus).toHaveBeenCalledWith(
            expect.anything(), ['202608260001'], 'Failed', expect.objectContaining({ failedAt: true })
        );
    });
});

describe('listPrintersAsync (Test 2, 3)', () => {
    test('returns detected printers', async () => {
        printerDetection.detectPrinters.mockResolvedValue([ONLINE_PRINTER]);
        const result = await service.listPrintersAsync();
        expect(result.success).toBe(true);
        expect(result.printers).toEqual([ONLINE_PRINTER]);
    });

    test('returns an empty list rather than throwing when nothing is detected', async () => {
        printerDetection.detectPrinters.mockResolvedValue([]);
        const result = await service.listPrintersAsync();
        expect(result.success).toBe(true);
        expect(result.printers).toEqual([]);
    });

    test('forceRefresh is passed through to bypass the detection cache', async () => {
        await service.listPrintersAsync({ forceRefresh: true });
        expect(printerDetection.detectPrinters).toHaveBeenCalledWith({ forceRefresh: true });
    });
});
