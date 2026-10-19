$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testData=Join-Path $root ('data\qa-desktop-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testData -Force | Out-Null
$previousData=$env:WORKBENCH_TEST_DATA_DIR
$previousNode=$env:ELECTRON_RUN_AS_NODE
try {
  $env:WORKBENCH_TEST_DATA_DIR=$testData
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $executable=Join-Path $root 'node_modules\electron\dist\electron.exe'
  $process=Start-Process -FilePath $executable -ArgumentList @('.', '--smoke-test') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testData 'stdout.log') -RedirectStandardError (Join-Path $testData 'stderr.log') -PassThru
  if(-not $process.WaitForExit(60000)){Stop-Process -Id $process.Id;throw "Desktop verification timed out: $testData"}
  $resultFile=Join-Path $testData 'smoke-result.json'
  if(-not (Test-Path -LiteralPath $resultFile)){throw "Desktop result missing: $testData"}
  $result=Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  if(-not $result.ok){throw ($result | ConvertTo-Json -Compress)}
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  $env:WORKBENCH_TEST_DATA_DIR=$previousData
  $env:ELECTRON_RUN_AS_NODE=$previousNode
}
