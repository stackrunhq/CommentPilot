param([string]$UpgradeFrom)
$ErrorActionPreference='Stop'
$existing=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -eq 'CommentPilot' -or $_.Publisher -match '^(CommentPilot|Douyin Reply Workbench)$'}
if($existing){throw 'An existing user installation was found; refusing to replace it during automated testing.'}
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$installDir=[IO.Path]::GetFullPath((Join-Path $root ('release\install-test-'+[Guid]::NewGuid().ToString('N'))))
if(-not $installDir.StartsWith((Join-Path $root 'release\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe install test directory'}
if(Test-Path -LiteralPath $installDir){throw 'Install test directory already exists; use a clean test location'}
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
$installer=Join-Path $root "release\CommentPilot-Setup-$version-x64.exe"
if($UpgradeFrom){
  $old=Start-Process -FilePath $UpgradeFrom -ArgumentList @('/S',"/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if($old.ExitCode -ne 0){throw 'Legacy test installation failed'}
}
$install=Start-Process -FilePath $installer -ArgumentList @('/S',"/D=$installDir") -WindowStyle Hidden -Wait -PassThru
if($install.ExitCode -ne 0){throw "Installer failed: $($install.ExitCode)"}
$apps=Get-ChildItem -LiteralPath $installDir -Filter '*.exe' | Where-Object {$_.Name -notlike 'Uninstall*'}
if(@($apps).Count -ne 1){throw 'Installed executable missing or ambiguous'}
$executable=$apps.FullName
& (Join-Path $PSScriptRoot 'smoke.ps1') -Executable $executable
$uninstall=Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe'
if(@($uninstall).Count -ne 1){throw 'Uninstaller missing or ambiguous'}
$null=Start-Process -FilePath $uninstall.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
for($attempt=0;$attempt -lt 100 -and (Test-Path -LiteralPath $executable);$attempt++){Start-Sleep -Milliseconds 300}
if(Test-Path -LiteralPath $executable){throw 'Uninstaller did not remove installed executable'}
Write-Output 'Installer, installed application, bundled Chromium, OCR, and uninstall checks passed.'
