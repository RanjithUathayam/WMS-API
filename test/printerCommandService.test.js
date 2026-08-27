const { buildTsplCommand, mmToDots, inferPrinterLanguage, PrintableAreaError } = require('../service/printerCommandService');

describe('printerCommandService.buildTsplCommand', () => {
    const baseSettings = { labelWidthMm: 90, labelHeightMm: 44, gapMm: 3, offsetMm: 0, density: 10, speed: 2 };

    test('applies density/speed/gap/offset/dimensions to the actual command, not just storing them', () => {
        const cmd = buildTsplCommand({ ...baseSettings, density: 12, speed: 3, gapMm: 4.5, offsetMm: -1, labels: [] });
        expect(cmd).toContain('SIZE 90 mm, 44 mm');
        expect(cmd).toContain('GAP 4.5 mm, 0 mm');
        expect(cmd).toContain('OFFSET -1 mm');
        expect(cmd).toContain('DENSITY 12');
        expect(cmd).toContain('SPEED 3');
    });

    test('QR value always equals the Label Number', () => {
        const cmd = buildTsplCommand({ ...baseSettings, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }] });
        expect(cmd).toContain('QRCODE 32,32,L,8,A,0,"202608260001"');
        expect(cmd).toContain('TEXT 32,264,"3",0,1,2,"202608260001"');
    });

    test('QR cell width and text scale are larger than the printer default, for legibility on the physical label', () => {
        const cmd = buildTsplCommand({ ...baseSettings, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }] });
        expect(cmd).toMatch(/QRCODE \d+,\d+,L,8,A,/); // cell width 8, not the original 4
        expect(cmd).toMatch(/TEXT \d+,\d+,"3",0,1,2,/); // 2x taller (y), not the original 1,1
    });

    test('offsetMm actually shifts the printed content position, not just the OFFSET calibration line', () => {
        const zero = buildTsplCommand({ ...baseSettings, offsetMm: 0, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }] });
        const shifted = buildTsplCommand({ ...baseSettings, offsetMm: 2, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }] });

        expect(zero).toContain('QRCODE 32,32,');
        // 2mm at 203dpi ≈ 16 dots
        expect(shifted).toContain('QRCODE 32,48,');
        expect(shifted).not.toContain('QRCODE 32,32,');
        expect(zero).not.toBe(shifted);
    });

    test('a negative offsetMm shifts content upward (toward the sensor)', () => {
        const shifted = buildTsplCommand({ ...baseSettings, offsetMm: -2, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }] });
        // -2mm at 203dpi ≈ -16 dots
        expect(shifted).toContain('QRCODE 32,16,');
    });

    test('copies repeats the same label via PRINT n, never generates extra QR/label blocks', () => {
        const cmd = buildTsplCommand({ ...baseSettings, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 5 }] });
        expect(cmd.match(/QRCODE/g)).toHaveLength(1);
        expect(cmd).toContain('PRINT 5');
    });

    test('multiple labels each get their own block with independent copies', () => {
        const cmd = buildTsplCommand({
            ...baseSettings,
            labels: [
                { labelNumber: '202608260001', qrValue: '202608260001', copies: 2 },
                { labelNumber: '202608260002', qrValue: '202608260002', copies: 3 }
            ]
        });
        expect(cmd.match(/QRCODE/g)).toHaveLength(2);
        expect(cmd).toContain('"202608260001"');
        expect(cmd).toContain('"202608260002"');
        expect(cmd).toContain('PRINT 2');
        expect(cmd).toContain('PRINT 3');
    });

    test('copies defaults to 1 when missing or non-positive', () => {
        const cmd = buildTsplCommand({ ...baseSettings, labels: [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 0 }] });
        expect(cmd).toContain('PRINT 1');
    });
});

describe('printerCommandService.buildTsplCommand — printable area (brand/hologram sections)', () => {
    const baseSettings = { labelWidthMm: 90, labelHeightMm: 44, gapMm: 3, offsetMm: 0, density: 10, speed: 2 };
    const oneLabel = [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }];

    test('content is positioned inside the printable/center section, not the label\'s raw left edge', () => {
        // Default template split: 37% brand, 53% center, 10% hologram of a 90mm label.
        const printableXMm = 0.37 * 90; // 33.3mm
        const printableWidthMm = 0.53 * 90; // 47.7mm

        const cmd = buildTsplCommand({ ...baseSettings, printableXMm, printableWidthMm, labels: oneLabel });

        // Content must start at/after the brand section ends (33.3mm + 4mm margin = 37.3mm -> 298 dots),
        // never at the old hard-coded x=4mm (32 dots), which used to land inside the brand section.
        expect(cmd).not.toContain('QRCODE 32,');
        expect(cmd).toContain('QRCODE 298,');
    });

    test('with no printable-area override, defaults to the whole label width (backward compatible)', () => {
        const cmd = buildTsplCommand({ ...baseSettings, labels: oneLabel });
        expect(cmd).toContain('QRCODE 32,32,');
    });

    test('throws PrintableAreaError (not a generic Error) when content would exceed a too-narrow printable section', () => {
        expect(() => buildTsplCommand({
            ...baseSettings, printableXMm: 40, printableWidthMm: 5, labels: oneLabel
        })).toThrow(PrintableAreaError);
    });

    test('PrintableAreaError identifies which element exceeded the boundary', () => {
        try {
            buildTsplCommand({ ...baseSettings, printableXMm: 40, printableWidthMm: 5, labels: oneLabel });
            throw new Error('expected buildTsplCommand to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(PrintableAreaError);
            expect(error.code).toBe('PRINTABLE_AREA_EXCEEDED');
            expect(error.message).toMatch(/QR code|Label Number text/);
            expect(error.details.length).toBeGreaterThan(0);
        }
    });

    test('rejects a printable area that does not fit inside the physical label', () => {
        expect(() => buildTsplCommand({
            ...baseSettings, printableXMm: 80, printableWidthMm: 30, labels: oneLabel
        })).toThrow(/Invalid printable area/);
    });
});

describe('printerCommandService.buildTsplCommand — DPI and rotation', () => {
    const baseSettings = { labelWidthMm: 90, labelHeightMm: 44, gapMm: 3, offsetMm: 0, density: 10, speed: 2 };
    const oneLabel = [{ labelNumber: '202608260001', qrValue: '202608260001', copies: 1 }];

    test('DPI is read from the printer profile, not hard-coded — 300 DPI produces different dot coordinates than 203 DPI', () => {
        const at203 = buildTsplCommand({ ...baseSettings, dpi: 203, labels: oneLabel });
        const at300 = buildTsplCommand({ ...baseSettings, dpi: 300, labels: oneLabel });
        expect(at203).toContain('QRCODE 32,32,');
        expect(at300).toContain('QRCODE 47,47,'); // 4mm * 300/25.4 ≈ 47 dots
        expect(at203).not.toBe(at300);
    });

    test('rotation is passed through to the QRCODE/TEXT commands, not silently dropped', () => {
        const cmd = buildTsplCommand({ ...baseSettings, rotation: 90, labels: oneLabel });
        expect(cmd).toContain('QRCODE 32,32,L,8,A,90,"202608260001"');
        expect(cmd).toContain('TEXT 32,264,"3",90,1,2,"202608260001"');
    });
});

describe('printerCommandService.mmToDots', () => {
    test('converts millimetres to dots at 203dpi', () => {
        expect(mmToDots(25.4)).toBe(203);
        expect(mmToDots(0)).toBe(0);
    });
});

describe('printerCommandService.inferPrinterLanguage', () => {
    test.each([
        ['TSC TE210', 'TSPL'],
        ['TSC TTP-244 Pro', 'TSPL'],
        ['Zebra ZD420', 'ZPL'],
        ['Microsoft Print to PDF', 'PDF'],
        ['HP LaserJet', 'WINDOWS'],
        [undefined, 'WINDOWS']
    ])('%s -> %s', (name, expected) => {
        expect(inferPrinterLanguage(name)).toBe(expected);
    });
});
