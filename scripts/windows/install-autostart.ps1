# Makes Statement Sorter start automatically (hidden) when you log in to Windows,
# and installs the "Statement Sorter" app shortcut on the desktop and in the Start menu.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1

$vbs = Join-Path $PSScriptRoot "start-hidden.vbs"
$shell = New-Object -ComObject WScript.Shell

$startup = [Environment]::GetFolderPath("Startup")
$lnk = $shell.CreateShortcut((Join-Path $startup "Statement Sorter Server.lnk"))
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = "`"$vbs`""
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Save()

& (Join-Path $PSScriptRoot "install-app.ps1")

# Start it now too (via Explorer so it is not tied to the terminal that ran this)
explorer.exe $vbs
Write-Host "Statement Sorter will now start at login. Open http://expensesort (or use the Statement Sorter app on your desktop)."
