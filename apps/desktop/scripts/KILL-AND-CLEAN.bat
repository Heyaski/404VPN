@echo off
chcp 65001 >nul
echo ========================================
echo  404VPN — убить все процессы и адаптеры
echo  Запусти этот файл ОТ ИМЕНИ АДМИНИСТРАТОРА
echo ========================================
echo.

taskkill /F /IM 404VPN.exe 2>nul
taskkill /F /IM tunnel-helper.exe 2>nul
timeout /t 2 /nobreak >nul

powershell -NoProfile -Command ^
  "$ErrorActionPreference='SilentlyContinue'; ^
   Get-NetAdapter | Where-Object { $_.Name -like '404vpn*' -or $_.InterfaceDescription -eq 'WireGuard Tunnel' } | ForEach-Object { Write-Host ('Disable ' + $_.Name); Disable-NetAdapter -Name $_.Name -Confirm:$false; Remove-NetIPAddress -InterfaceIndex $_.ifIndex -Confirm:$false; Remove-NetRoute -InterfaceIndex $_.ifIndex -Confirm:$false }; ^
   Get-PnpDevice -Class Net | Where-Object { $_.FriendlyName -match 'WireGuard Tunnel' -or $_.InstanceId -match 'Wintun' } | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false; Remove-PnpDevice -InstanceId $_.InstanceId -Confirm:$false }; ^
   Write-Host '--- remaining ---'; ^
   Get-NetAdapter | Where-Object { $_.Name -like '404vpn*' } | Format-Table Name,Status; ^
   Get-Process 404VPN,tunnel-helper -ErrorAction SilentlyContinue | Format-Table Id,ProcessName"

echo.
echo Готово. Теперь запусти:
echo   releases\desktop-v3\win-unpacked\404VPN.exe
echo.
pause
