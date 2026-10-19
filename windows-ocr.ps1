param([Parameter(Mandatory=$true)][string]$ImagePath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
# Prefer the saved original over a downscaled preview; remove large dark video borders.
$sourceName=[IO.Path]::GetFileName($ImagePath) -replace '^windows-','source-'
$sourcePath=Join-Path ([IO.Path]::GetDirectoryName($ImagePath)) $sourceName
if(Test-Path -LiteralPath $sourcePath){$ImagePath=$sourcePath}
$original=[Drawing.Bitmap]::new($ImagePath)
try{
  $start=-1;$bestStart=0;$bestHeight=0;$stepX=[Math]::Max(1,[int]($original.Width/160))
  for($y=0;$y -lt $original.Height;$y+=4){
    $bright=0;$total=0
    for($x=0;$x -lt $original.Width;$x+=$stepX){$pixel=$original.GetPixel($x,$y);$total++;if($pixel.R -gt 170 -and $pixel.G -gt 170 -and $pixel.B -gt 170){$bright++}}
    if($bright/$total -gt 0.45){if($start -lt 0){$start=$y}}
    elseif($start -ge 0){if($y-$start -gt $bestHeight){$bestStart=$start;$bestHeight=$y-$start};$start=-1}
  }
  if($start -ge 0 -and $original.Height-$start -gt $bestHeight){$bestStart=$start;$bestHeight=$original.Height-$start}
  if($bestHeight -lt 160){$bestStart=0;$bestHeight=$original.Height}
  $rect=[Drawing.Rectangle]::new(0,$bestStart,$original.Width,$bestHeight)
  $crop=$original.Clone($rect,$original.PixelFormat)
  try{
    $scale=[Math]::Min(2400/$crop.Width,2400/$crop.Height)
    $scaled=[Drawing.Bitmap]::new([Math]::Max(1,[int]($crop.Width*$scale)),[Math]::Max(1,[int]($crop.Height*$scale)))
    try{$graphics=[Drawing.Graphics]::FromImage($scaled);try{$graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$graphics.DrawImage($crop,0,0,$scaled.Width,$scaled.Height)}finally{$graphics.Dispose()}
      $ImagePath=Join-Path ([IO.Path]::GetDirectoryName($OutputPath)) ('crop-'+[IO.Path]::GetFileNameWithoutExtension($OutputPath)+'.png')
      $scaled.Save($ImagePath,[Drawing.Imaging.ImageFormat]::Png)
    }finally{$scaled.Dispose()}
  }finally{$crop.Dispose()}
}finally{$original.Dispose()}
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
function Await-WinRT($Operation,[Type]$ResultType){$task=$asTask.MakeGenericMethod($ResultType).Invoke($null,@($Operation));$task.GetAwaiter().GetResult()}
$file=Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream=Await-WinRT ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
try{
  $decoder=Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap=Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try{
    $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if($null -eq $engine){throw 'Windows OCR language is not installed'}
    $result=Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $json=@{text=($result.Lines | ForEach-Object {$_.Text}) -join "`n";language=$engine.RecognizerLanguage.LanguageTag} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($OutputPath,$json,[Text.UTF8Encoding]::new($false))
  }finally{$bitmap.Dispose()}
}finally{$stream.Dispose()}
