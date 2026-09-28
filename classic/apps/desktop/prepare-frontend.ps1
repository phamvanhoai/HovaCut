$ErrorActionPreference = "Stop"

$webDirectory = Resolve-Path (Join-Path $PSScriptRoot "..\web")
$outputDirectory = Join-Path $PSScriptRoot "frontend"
$desktopDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($outputDirectory)
$standaloneDirectory = Join-Path $webDirectory ".next\standalone"
$standaloneWeb = Join-Path $standaloneDirectory "apps\web"

if (-not $resolvedOutputDirectory.StartsWith($desktopDirectory + [System.IO.Path]::DirectorySeparatorChar)) {
	throw "Refusing to replace a frontend directory outside the desktop project."
}

Push-Location $webDirectory
try {
	& (Join-Path $webDirectory "node_modules\.bin\next.exe") build --webpack
	if ($LASTEXITCODE -ne 0) { throw "Next.js production build failed." }
}
finally {
	Pop-Location
}

if (Test-Path -LiteralPath $outputDirectory) {
	Remove-Item -LiteralPath $outputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $outputDirectory | Out-Null
Copy-Item -Path (Join-Path $standaloneDirectory "*") -Destination $outputDirectory -Recurse -Force

# Bun's standalone trace contains Windows junctions that point back to the
# development checkout. Materialize Next's runtime packages so the installed
# application remains portable on another machine.
$runtimeModules = Join-Path $outputDirectory "apps\web\node_modules"
$bunPackages = Join-Path $webDirectory "..\..\node_modules\.bun"
function Copy-RuntimePackage([string]$source, [string]$destination) {
	if (-not (Test-Path -LiteralPath $source)) { throw "Missing runtime package: $source" }
	if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
	New-Item -ItemType Directory -Path $destination -Force | Out-Null
	Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
}
Copy-RuntimePackage (Resolve-Path (Join-Path $webDirectory "node_modules\next")).Path (Join-Path $runtimeModules "next")
Copy-RuntimePackage (Resolve-Path (Join-Path $webDirectory "node_modules\react")).Path (Join-Path $runtimeModules "react")
Copy-RuntimePackage (Resolve-Path (Join-Path $webDirectory "node_modules\react-dom")).Path (Join-Path $runtimeModules "react-dom")
Copy-RuntimePackage (Resolve-Path (Join-Path $webDirectory "node_modules\sharp")).Path (Join-Path $runtimeModules "sharp")
Copy-RuntimePackage (Get-ChildItem (Join-Path $bunPackages "styled-jsx@*\node_modules\styled-jsx") | Select-Object -First 1 -ExpandProperty FullName) (Join-Path $runtimeModules "styled-jsx")
Copy-RuntimePackage (Get-ChildItem (Join-Path $bunPackages "@next+env@*\node_modules\@next\env") | Select-Object -First 1 -ExpandProperty FullName) (Join-Path $runtimeModules "@next\env")
Copy-RuntimePackage (Get-ChildItem (Join-Path $bunPackages "@swc+helpers@*\node_modules\@swc\helpers") | Select-Object -First 1 -ExpandProperty FullName) (Join-Path $runtimeModules "@swc\helpers")

New-Item -ItemType Directory -Path (Join-Path $outputDirectory "apps\web\.next") -Force | Out-Null
Copy-Item -Path (Join-Path $webDirectory ".next\static") -Destination (Join-Path $outputDirectory "apps\web\.next\static") -Recurse -Force
$serverWasm = Join-Path $webDirectory ".next\server\chunks\static\wasm"
if (Test-Path -LiteralPath $serverWasm) {
	New-Item -ItemType Directory -Path (Join-Path $outputDirectory "apps\web\.next\server\static") -Force | Out-Null
	Copy-Item -Path $serverWasm -Destination (Join-Path $outputDirectory "apps\web\.next\server\static\wasm") -Recurse -Force
}
Copy-Item -Path (Join-Path $webDirectory "public") -Destination (Join-Path $outputDirectory "apps\web\public") -Recurse -Force
Copy-Item -LiteralPath "C:\Program Files\nodejs\node.exe" -Destination (Join-Path $outputDirectory "node.exe") -Force
New-Item -ItemType File -Path (Join-Path $outputDirectory ".gitkeep") -Force | Out-Null

Write-Host "Prepared desktop frontend at $outputDirectory"
