<#
    Sends a raw TSPL/ZPL/EPL command file to a Windows printer's spooler queue as raw bytes, bypassing
    the driver's own text/graphics rendering (so the printer receives exactly the command language it
    expects). Invoked via child_process.execFile('powershell.exe', ['-File', thisPath, '-PrinterName',
    name, '-FilePath', path], ...) — execFile passes each argument as a separate, opaque argv entry
    with no shell involved, so PrinterName/FilePath can never be interpreted as additional PowerShell
    code no matter what characters they contain. See service/printerDetectionService.js: sendRawToPrinterAsync.

    NOTE: this has not been verified against a physical printer in this environment (no thermal
    printer was online/reachable during development) — see the caller for details.
#>
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

try {
    $printer = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$($PrinterName.Replace("'", "''"))'"
    if (-not $printer) {
        Write-Error "Printer not found: $PrinterName"
        exit 2
    }
    if ($printer.WorkOffline) {
        Write-Error "Printer is offline: $PrinterName"
        exit 3
    }

    $bytes = [System.IO.File]::ReadAllBytes($FilePath)

    # Win32 spooler API (winspool.drv) — the standard way to push raw bytes straight to a print
    # queue without the driver reinterpreting them as text/graphics.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        try
        {
            var di = new DOCINFOA { pDocName = "Label Print", pDataType = "RAW" };
            if (!StartDocPrinter(hPrinter, 1, di)) return false;
            try
            {
                if (!StartPagePrinter(hPrinter)) return false;
                int written;
                bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
                EndPagePrinter(hPrinter);
                return ok && written == bytes.Length;
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
'@

    $sent = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
    if (-not $sent) {
        Write-Error "WritePrinter did not confirm all bytes were written to $PrinterName"
        exit 4
    }

    Write-Output (ConvertTo-Json -InputObject @{ ok = $true } -Compress)
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
