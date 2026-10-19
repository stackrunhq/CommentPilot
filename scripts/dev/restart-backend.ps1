$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$listener=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue
if($listener){
  $state=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/state'
  if($null -eq $state.config.selectors){throw 'Port 3210 is not this workbench; refusing to stop it.'}
  $ownerId=$listener.OwningProcess | Select-Object -Unique
  if(@($ownerId).Count -ne 1){throw 'Ambiguous listener process'}
  $process=Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId"
  if($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'server\.js'){throw 'Listener is not the expected Node backend'}
  Write-Output 'Restarting CommentPilot. Saved encrypted model connections are retained.'
  Stop-Process -Id $ownerId
  Wait-Process -Id $ownerId -Timeout 10 -ErrorAction SilentlyContinue
}
$node=(Get-Command node.exe).Source
$null=New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force
$stdout=Join-Path $root 'data/backend.stdout.log'
$stderr=Join-Path $root 'data/backend.stderr.log'
$child=Start-Process -FilePath $node -ArgumentList @('src/app/server.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$ready=$false
for($attempt=0;$attempt -lt 30;$attempt++){
  try{
    $health=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 2
    if($health.app -ne 'commentpilot'){throw 'Unexpected backend identity'}
    $ready=$true;break
  }catch{Start-Sleep -Milliseconds 300}
}
if(-not $ready){throw "Backend did not become ready; inspect $stderr"}
Write-Output "CommentPilot started (PID $($child.Id)). http://127.0.0.1:3210"
