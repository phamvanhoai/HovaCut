$ErrorActionPreference = "Stop"

$desktopDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
$uiDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\desktop-ui"))
$webDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\web"))
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "dist"))
$exportDirectory = Join-Path $uiDirectory "out"
$uiNodeModules = Join-Path $uiDirectory "node_modules"
$tauriDirectory = Join-Path $desktopDirectory "src-tauri"
$bundledFfmpeg = Join-Path $tauriDirectory "resources\ffmpeg.exe"

if (-not $outputDirectory.StartsWith($desktopDirectory + [System.IO.Path]::DirectorySeparatorChar)) {
	throw "Refusing to replace a frontend directory outside the desktop project."
}

if (-not (Test-Path -LiteralPath $uiNodeModules)) {
	New-Item -ItemType Junction -Path $uiNodeModules -Target (Join-Path $webDirectory "node_modules") | Out-Null
}

if (-not (Test-Path -LiteralPath $bundledFfmpeg)) {
	$ffmpegCandidates = @(@(
		$env:HOVACUT_FFMPEG_PATH,
		"E:\CGT Auto Tools v1.3.0\ffmpeg.exe",
		(Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
	) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
	if ($ffmpegCandidates.Count -eq 0) {
		throw "FFmpeg not found. Set HOVACUT_FFMPEG_PATH before building HovaCut."
	}
	New-Item -ItemType Directory -Path (Split-Path -Parent $bundledFfmpeg) -Force | Out-Null
	Copy-Item -LiteralPath $ffmpegCandidates[0] -Destination $bundledFfmpeg -Force
	Write-Host "Prepared bundled FFmpeg from $($ffmpegCandidates[0])"
}

Push-Location $uiDirectory
try {
	& (Join-Path $uiNodeModules ".bin\next.exe") build --webpack
	if ($LASTEXITCODE -ne 0) { throw "HovaCut desktop UI build failed." }
}
finally {
	Pop-Location
}

if (Test-Path -LiteralPath $outputDirectory) {
	Remove-Item -LiteralPath $outputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $outputDirectory | Out-Null
Copy-Item -Path (Join-Path $exportDirectory "*") -Destination $outputDirectory -Recurse -Force
Copy-Item -Path (Join-Path $webDirectory "public\*") -Destination $outputDirectory -Recurse -Force

Write-Host "Prepared static desktop frontend at $outputDirectory"
