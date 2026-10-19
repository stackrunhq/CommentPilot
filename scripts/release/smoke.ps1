param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testData=Join-Path $root ('release\qa-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testData -Force | Out-Null
$env:WORKBENCH_TEST_DATA_DIR=$testData
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$process=Start-Process -FilePath $Executable -ArgumentList '--smoke-test' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testData 'desktop.stdout.log') -RedirectStandardError (Join-Path $testData 'desktop.stderr.log') -PassThru
if(-not $process.WaitForExit(120000)){Stop-Process -Id $process.Id;throw "Application test timed out: $testData"}
$resultFile=Join-Path $testData 'smoke-result.json'
if(-not (Test-Path -LiteralPath $resultFile)){throw "No smoke result. Inspect $testData"}
$result=Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
if(-not $result.ok){throw ($result | ConvertTo-Json -Compress)}
Write-Output ($result | ConvertTo-Json -Compress)
Write-Output "Isolated test data: $testData"
