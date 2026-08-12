$ErrorActionPreference = "Stop"
$desktop = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# wait — apps/desktop/scripts -> apps/desktop
$appRoot = Split-Path $PSScriptRoot -Parent
Set-Location $appRoot
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$log = Join-Path $env:TEMP "404vpn-diag.txt"
"== diag start $(Get-Date -Format o) ==" | Out-File $log -Encoding utf8
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"admin=$admin" | Out-File $log -Append -Encoding utf8
npx --yes electron scripts/diag-tunnel.mjs *>> $log 2>&1
"exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
