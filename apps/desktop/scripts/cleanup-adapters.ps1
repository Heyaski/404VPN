# Запуск от администратора: чистит зависшие адаптеры 404vpn / Wintun
$ErrorActionPreference = "SilentlyContinue"
Write-Host "Cleaning 404vpn / WireGuard Tunnel adapters..."

Get-NetAdapter | Where-Object {
  $_.InterfaceDescription -eq "WireGuard Tunnel" -and $_.Name -like "404vpn*"
} | ForEach-Object {
  Write-Host "Adapter $($_.Name) (ifIndex=$($_.ifIndex))"
  Disable-NetAdapter -Name $_.Name -Confirm:$false
  Get-NetIPAddress -InterfaceIndex $_.ifIndex | Remove-NetIPAddress -Confirm:$false
  Get-NetRoute -InterfaceIndex $_.ifIndex | Remove-NetRoute -Confirm:$false
}

Get-PnpDevice -Class Net | Where-Object {
  $_.FriendlyName -match "WireGuard Tunnel" -or $_.InstanceId -match "Wintun"
} | ForEach-Object {
  Write-Host "PnP $($_.FriendlyName) $($_.InstanceId)"
  Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false
  Remove-PnpDevice -InstanceId $_.InstanceId -Confirm:$false
}

Write-Host "`nRemaining:"
Get-NetAdapter | Where-Object { $_.Name -like "404vpn*" -or $_.InterfaceDescription -eq "WireGuard Tunnel" } |
  Format-Table Name, Status, InterfaceDescription
Write-Host "Done. You can close this window."
pause
