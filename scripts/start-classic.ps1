$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$classicRoot = Join-Path $workspaceRoot 'classic'
$envExample = Join-Path $classicRoot 'apps\web\.env.example'
$envLocal = Join-Path $classicRoot 'apps\web\.env.local'
$bun = 'C:\Users\Admin\.proto\shims\bun.exe'
$legacyFfmpeg = 'E:\CGT Auto Tools v1.3.0\ffmpeg.exe'

if (-not (Test-Path -LiteralPath $bun)) {
    throw 'Bun is missing. Run C:\Users\Admin\.proto\bin\proto.exe use first.'
}

if (-not (Test-Path -LiteralPath $envLocal)) {
    Copy-Item -LiteralPath $envExample -Destination $envLocal
    Write-Host 'Created classic/apps/web/.env.local from the development defaults.'
}

$env:HOVACUT_ENABLE_LOCAL_AUTOMATION = 'true'
if ([string]::IsNullOrWhiteSpace($env:HOVACUT_FFMPEG_PATH) -and (Test-Path -LiteralPath $legacyFfmpeg)) {
    $env:HOVACUT_FFMPEG_PATH = $legacyFfmpeg
    Write-Host "Using local FFmpeg: $legacyFfmpeg"
}

Push-Location $classicRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $classicRoot 'node_modules'))) {
        & $bun install
        if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }
    }
    & $bun run dev:web
} finally {
    Pop-Location
}
