const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

class PrinterDetectionError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const DETECT_SCRIPT = path.join(__dirname, '..', 'scripts', 'detect-printers.ps1');
const SEND_SCRIPT = path.join(__dirname, '..', 'scripts', 'send-raw-print.ps1');
const EXEC_TIMEOUT_MS = 10000;

// Printer enumeration has real (~150-300ms) process-spawn overhead, and a settings screen may poll
// it repeatedly in a short span — a short cache avoids hammering the OS without going stale for long.
const DETECT_CACHE_TTL_MS = 5000;
let cache = { at: 0, printers: null };

// Win32_Printer.PrinterStatus (see MSDN) — only the values actually observed/documented are mapped;
// anything else falls back to 'unknown' rather than guessing.
const STATUS_BY_CODE = {
    1: 'other',
    2: 'unknown',
    3: 'available', // "Idle" — ready to print
    4: 'printing',
    5: 'warming-up',
    6: 'stopped',
    7: 'offline'
};

function mapPrinterStatus(code, workOffline) {
    if (workOffline) return 'offline';
    return STATUS_BY_CODE[Number(code)] || 'unknown';
}

/**
 * Never resolves with a raw stack trace or OS-specific detail beyond a short message — see
 * "Never expose sensitive OS information" / "Do not return raw OS stack traces" in the spec.
 */
function runPowerShellFile(scriptPath, args) {
    return new Promise((resolve, reject) => {
        // execFile can both invoke the callback with an error (the documented path) AND throw
        // synchronously out of the spawn() call itself (e.g. EPERM from a sandboxed/restricted
        // process) — the try/catch here covers the latter so callers always see the same
        // {error, stdout, stderr} rejection shape regardless of which one happened.
        try {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
                { timeout: EXEC_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject({ error, stdout, stderr });
                        return;
                    }
                    resolve(stdout);
                }
            );
        } catch (error) {
            reject({ error, stdout: '', stderr: '' });
        }
    });
}

/**
 * Detects Windows-installed printers via Win32_Printer (scripts/detect-printers.ps1, invoked through
 * execFile with a fixed argv array — never a shell, and the script takes no request-derived input).
 * Returns [] with the failure logged server-side on any detection error, rather than throwing — a
 * transient detection failure shouldn't take down the whole printer-settings screen. Callers that
 * need to distinguish "no printers" from "detection is broken" should use detectPrintersOrThrow.
 */
async function detectPrinters({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && cache.printers && now - cache.at < DETECT_CACHE_TTL_MS) {
        return cache.printers;
    }

    let printers;
    try {
        printers = await detectPrintersOrThrow();
    } catch (error) {
        console.error('Printer detection failed:', error.message);
        return cache.printers || [];
    }

    cache = { at: now, printers };
    return printers;
}

async function detectPrintersOrThrow() {
    let stdout;
    try {
        stdout = await runPowerShellFile(DETECT_SCRIPT, []);
    } catch ({ error, stderr }) {
        console.error('Printer detection PowerShell call failed:', error.message, stderr);
        throw new PrinterDetectionError('PRINTER_DETECTION_FAILED', 'Unable to query installed printers.');
    }

    let raw;
    try {
        raw = JSON.parse(stdout);
    } catch (parseError) {
        console.error('Printer detection returned unparseable output:', parseError.message, stdout);
        throw new PrinterDetectionError('PRINTER_DETECTION_FAILED', 'Unable to query installed printers.');
    }

    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.map(row => ({
        name: row.Name,
        status: mapPrinterStatus(row.PrinterStatus, row.WorkOffline),
        isDefault: !!row.Default
    }));
}

/**
 * Sends raw command bytes (e.g. TSPL) straight to a printer's spooler queue via the Win32 spooler
 * API (scripts/send-raw-print.ps1). printerName/commandText are passed as separate execFile argv
 * entries (via a temp file for the body) — never concatenated into a shell command string — so
 * arbitrary characters in either can never be interpreted as additional commands.
 *
 * Not verified against physical hardware: no thermal printer was online/reachable in the environment
 * this was built in (only the OS-level "installed but offline" state and the not-found error path
 * could be exercised). Verify against real hardware before relying on this in production.
 */
async function sendRawToPrinterAsync(printerName, commandText) {
    const tempFile = path.join(os.tmpdir(), `label-print-${crypto.randomBytes(8).toString('hex')}.tspl`);
    await fs.writeFile(tempFile, commandText, 'utf8');

    try {
        await runPowerShellFile(SEND_SCRIPT, ['-PrinterName', printerName, '-FilePath', tempFile]);
    } catch ({ stderr }) {
        const message = (stderr || '').trim();
        if (message.includes('Printer not found:')) {
            throw new PrinterDetectionError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
        }
        if (message.includes('Printer is offline:')) {
            throw new PrinterDetectionError('PRINTER_OFFLINE', `Printer is offline: ${printerName}`);
        }
        console.error('Raw print send failed:', message);
        throw new PrinterDetectionError('PRINT_FAILED', 'The printer did not accept the print job.');
    } finally {
        await fs.unlink(tempFile).catch(() => {});
    }
}

module.exports = {
    PrinterDetectionError,
    mapPrinterStatus,
    detectPrinters,
    detectPrintersOrThrow,
    sendRawToPrinterAsync
};
