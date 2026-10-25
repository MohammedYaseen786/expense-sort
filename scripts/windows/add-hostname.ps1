# Points http://expensesort at this laptop by adding it to the Windows hosts file. Needs admin.

$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
if (-not (Select-String -Path $hosts -Pattern "^\s*127\.0\.0\.2\s+expensesort\s*$" -Quiet)) {
  Add-Content -Path $hosts -Value "`r`n127.0.0.2 expensesort" -Encoding ASCII
}
ipconfig /flushdns | Out-Null
