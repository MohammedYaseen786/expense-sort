# Installs Statement Sorter as a desktop app: a "Statement Sorter" shortcut with its own icon
# on the desktop and in the Start menu. It opens in its own window and can be pinned to the taskbar.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-app.ps1

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$icon = Join-Path $root "public\icon.ico"
$launcher = Join-Path $PSScriptRoot "open-app.vbs"
$shell = New-Object -ComObject WScript.Shell

foreach ($dir in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
  Remove-Item (Join-Path $dir "Statement Sorter.url") -ErrorAction SilentlyContinue
  $lnk = $shell.CreateShortcut((Join-Path $dir "Statement Sorter.lnk"))
  $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $lnk.Arguments = "`"$launcher`""
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = "Sort bank statement transactions into categories"
  $lnk.Save()
}
Write-Host "Statement Sorter app installed: desktop and Start menu shortcuts."
