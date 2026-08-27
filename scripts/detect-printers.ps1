<#
    Lists Windows-installed printers for the Label Print backend's printer-detection API.
    Invoked via child_process.execFile('powershell.exe', ['-File', thisPath, ...], ...) — never
    through a shell, and this script takes no arguments derived from request input, so there is
    nothing here for a malicious printer name (or anything else in a request body) to inject into.
    See service/printerDetectionService.js.
#>
$ErrorActionPreference = 'Stop'

try {
    $printers = Get-CimInstance -ClassName Win32_Printer |
        Select-Object Name, PrinterStatus, WorkOffline, Default

    # ConvertTo-Json collapses a single-item pipeline to a bare object instead of a 1-element array —
    # -AsArray (PS 6.2+) would fix this directly, but wrapping in @() is the version-safe way.
    Write-Output (ConvertTo-Json -InputObject @($printers) -Compress)
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
