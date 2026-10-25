# Undoes install-autostart.ps1 and stops the running server.

Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) "Statement Sorter Server.lnk") -ErrorAction SilentlyContinue
foreach ($dir in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
  Remove-Item (Join-Path $dir "Statement Sorter.url"), (Join-Path $dir "Statement Sorter.lnk") -ErrorAction SilentlyContinue
}
& (Join-Path $PSScriptRoot "stop-server.ps1")
Write-Host "Statement Sorter autostart removed and server stopped."
