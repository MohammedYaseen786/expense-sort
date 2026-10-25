# Restarts the background server. Run after changing the code.

& (Join-Path $PSScriptRoot "stop-server.ps1")
# Via Explorer so the server is not tied to the terminal that ran this
explorer.exe (Join-Path $PSScriptRoot 'start-hidden.vbs')
Write-Host "Statement Sorter restarted at http://expensesort"
