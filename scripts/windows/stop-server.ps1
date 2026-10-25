# Stops the restart loop and the running Statement Sorter server (leaves SoleTracker alone).

Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like "*expensesort-server.cmd*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
