// TSC TTP-244 Pro / TE210 / TE310 are all TSPL-compatible thermal printers — this module only
// targets TSPL for now. Extend inferPrinterLanguage + a new buildXxxCommand() function if/when a
// ZPL or EPL printer needs supporting — do not bolt other languages onto buildTsplCommand itself.

class PrintableAreaError extends Error {
    constructor(message, details) {
        super(message);
        this.code = 'PRINTABLE_AREA_EXCEEDED';
        this.details = details;
    }
}

// Fallback only — the real value should come from the selected printer's own profile
// (T_LABEL_PRINT_CONFIG.DPI, see labelReservationService.resolvePrintSettings). This printer family
// is 203 DPI by default; a 300 DPI printer must have that recorded in its profile, never guessed.
const DEFAULT_DPI = 203;

/** dots = mm × dpi / 25.4 — computed from the printer's actual DPI, never a hard-coded approximation. */
function mmToDots(mm, dpi = DEFAULT_DPI) {
    return Math.round(Number(mm) * Number(dpi) / 25.4);
}

/** Best-effort classification from the printer name alone — see repository capability columns for
 *  an explicit override once a printer has been configured with a confirmed language/type. */
function inferPrinterLanguage(printerName) {
    const name = String(printerName || '').toLowerCase();
    if (name.includes('zebra') || name.includes('zpl')) return 'ZPL';
    if (name.includes('epl')) return 'EPL';
    if (name.includes('pdf')) return 'PDF';
    if (name.includes('tsc') || name.includes('te2') || name.includes('te3') || name.includes('ttp')) return 'TSPL';
    return 'WINDOWS';
}

// Minimum clearance kept between dynamic content and the printable section's own edges.
const CONTENT_MARGIN_MM = 4;
// QR module (cell) size in dots, and the TEXT command's independent x/y magnification — both TSPL
// parameters below (larger than the original 4 / 1,1, per user feedback that the printed QR/text
// were too small). Text is scaled TALLER only (y), not wider (x): a 12-character Label Number at 2x
// width (~53mm) would not fit inside the ~48mm center section on the default 90mm label/37-53-10
// template split — doubling both axes was tried and is exactly what the boundary check below caught.
// Bumping either constant here keeps the size change in one place — the footprint estimates right
// below are derived from these, not a second hard-coded number.
const QR_CELL_WIDTH_DOTS = 8;
const TEXT_X_SCALE = 1;
const TEXT_Y_SCALE = 2;
// Vertical clearance kept between the QR code's bottom edge and the text below it.
const CONTENT_SPACING_MM = 2;

// Conservative footprint ESTIMATES used only for the boundary check below (spec section 11) — not
// pixel-perfect rendering. A Version-2 QR (25x25 modules) and this printer family's built-in font "3"
// are safe upper bounds for a 12-16 character Label Number.
const QR_FOOTPRINT_MM = Math.ceil((25 * QR_CELL_WIDTH_DOTS) * 25.4 / DEFAULT_DPI) + 1; // +1mm safety pad
const TEXT_CHAR_WIDTH_MM = 2.2 * TEXT_X_SCALE;
const TEXT_HEIGHT_MM = 3.5 * TEXT_Y_SCALE;

/**
 * Debug-only structured logging of the physical coordinate calculation (spec section 16) — no
 * business data beyond the Label Number itself (already printed in plaintext/QR on the label, so it
 * isn't sensitive). Flip PRINT_COORDINATE_LOGGING off once positioning is confirmed correct in
 * production; it's deliberately verbose for debugging, not for routine operation.
 */
const PRINT_COORDINATE_LOGGING = true;

function logCalculation(entry) {
    if (!PRINT_COORDINATE_LOGGING) return;
    console.log('[label-print] coordinate calculation', JSON.stringify(entry));
}

/**
 * Checks that the QR code and Label Number text (see the coordinate math in buildTsplCommand) stay
 * inside the printable/"center" section on X, and inside the physical label on Y. Throws
 * PrintableAreaError — never silently clamps/warns-and-continues — because a print job that quietly
 * printed onto the brand/hologram design area is exactly the bug this was built to fix.
 */
function assertWithinPrintableArea({ printableXMm, printableWidthMm, labelHeightMm, qrXMm, qrYMm, textXMm, textYMm, textWidthMm }) {
    const violations = [];

    if (qrXMm < printableXMm || qrXMm + QR_FOOTPRINT_MM > printableXMm + printableWidthMm) {
        violations.push({ element: 'QR code', axis: 'x', value: qrXMm, limit: [printableXMm, printableXMm + printableWidthMm] });
    }
    if (qrYMm < 0 || qrYMm + QR_FOOTPRINT_MM > labelHeightMm) {
        violations.push({ element: 'QR code', axis: 'y', value: qrYMm, limit: [0, labelHeightMm] });
    }
    if (textXMm < printableXMm || textXMm + textWidthMm > printableXMm + printableWidthMm) {
        violations.push({ element: 'Label Number text', axis: 'x', value: textXMm, limit: [printableXMm, printableXMm + printableWidthMm] });
    }
    if (textYMm < 0 || textYMm + TEXT_HEIGHT_MM > labelHeightMm) {
        violations.push({ element: 'Label Number text', axis: 'y', value: textYMm, limit: [0, labelHeightMm] });
    }

    if (violations.length) {
        const first = violations[0];
        throw new PrintableAreaError(`${first.element} exceeds the configured printable area.`, violations);
    }
}

/**
 * Builds one TSPL command stream for a batch of labels, applying density/speed/gap/offset/dimensions
 * from the request to the actual printer commands rather than merely storing them.
 *
 * printableXMm/printableWidthMm describe the label's dynamic/"center" content section in millimeters
 * from the label's own left edge — the SAME BrandSectionWidth/CenterSectionWidth percentages the
 * frontend's on-screen preview uses to size its CSS grid columns (see LabelPrintComponent.
 * labelGridColumns / T_LABEL_TEMPLATE). Every dynamic element is positioned relative to
 * printableXMm — finalX = printableXMm + elementX + offset — never the label's raw (0,0) origin.
 * That was the root cause of content printing over the brand/design area while the preview looked
 * correct: this function used to hard-code x=4mm from the label's absolute left edge, completely
 * independent of where the brand section (~37% of the label width by default) actually ends.
 *
 * offsetMm is applied as a Y-axis shift of the printed content (QR code + text) — i.e. "print
 * positioning/alignment" — not TSPL's own `OFFSET` system command, which is a media/tear-off
 * *calibration* setting that doesn't move content on the current job. `OFFSET` is still sent too, as
 * a legitimate calibration hint, but it isn't what makes offsetMm visibly do anything. The frontend
 * preview shifts the whole grid vertically for the same reason (previewOffsetTransform).
 *
 * Gap is passed straight to TSPL's own `GAP` media command and never folded into any element's Y
 * coordinate — each label's content always starts fresh from that label's own physical origin
 * (REFERENCE 0,0), so a multi-label batch can never accumulate a growing offset from label to label.
 */
function buildTsplCommand({
    labelWidthMm, labelHeightMm, gapMm, offsetMm, density, speed, labels,
    printableXMm = 0, printableWidthMm = labelWidthMm,
    dpi = DEFAULT_DPI, rotation = 0, printerName
}) {
    if (printableWidthMm <= 0 || printableXMm < 0 || printableXMm + printableWidthMm > labelWidthMm) {
        throw new Error(`Invalid printable area (x=${printableXMm}mm, width=${printableWidthMm}mm) for a ${labelWidthMm}mm-wide label.`);
    }

    const lines = [
        `SIZE ${labelWidthMm} mm, ${labelHeightMm} mm`,
        `GAP ${gapMm} mm, 0 mm`,
        'REFERENCE 0,0',
        `OFFSET ${offsetMm} mm`,
        `DENSITY ${density}`,
        `SPEED ${speed}`,
        'DIRECTION 1'
    ];

    const margin = Math.min(CONTENT_MARGIN_MM, printableWidthMm / 4);
    const qrXMm = printableXMm + margin;
    const qrYMm = 4 + offsetMm;
    const textXMm = printableXMm + margin;
    // Derived from the QR's own footprint (not an independent fixed value) so text can never end up
    // overlapping a QR code that's been sized up — see QR_CELL_WIDTH_DOTS above.
    const textYMm = qrYMm + QR_FOOTPRINT_MM + CONTENT_SPACING_MM;

    for (const label of labels) {
        const textWidthMm = String(label.labelNumber).length * TEXT_CHAR_WIDTH_MM;

        assertWithinPrintableArea({ printableXMm, printableWidthMm, labelHeightMm, qrXMm, qrYMm, textXMm, textYMm, textWidthMm });

        logCalculation({
            printer: printerName, dpi, labelWidthMm, labelHeightMm,
            printableXMm, printableWidthMm, gapMm, offsetMm, rotation,
            label: label.labelNumber,
            qr: { xMm: qrXMm, yMm: qrYMm, xDots: mmToDots(qrXMm, dpi), yDots: mmToDots(qrYMm, dpi) },
            text: { xMm: textXMm, yMm: textYMm, xDots: mmToDots(textXMm, dpi), yDots: mmToDots(textYMm, dpi) }
        });

        const copies = Math.max(1, Number(label.copies) || 1);
        lines.push(
            'CLS',
            `QRCODE ${mmToDots(qrXMm, dpi)},${mmToDots(qrYMm, dpi)},L,${QR_CELL_WIDTH_DOTS},A,${rotation},"${label.qrValue}"`,
            `TEXT ${mmToDots(textXMm, dpi)},${mmToDots(textYMm, dpi)},"3",${rotation},${TEXT_X_SCALE},${TEXT_Y_SCALE},"${label.labelNumber}"`,
            `PRINT ${copies}`
        );
    }

    return lines.join('\r\n') + '\r\n';
}

module.exports = {
    PrintableAreaError,
    DEFAULT_DPI,
    mmToDots,
    inferPrinterLanguage,
    buildTsplCommand
};
