$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$classicRoot = Join-Path $workspaceRoot 'classic'
$envExample = Join-Path $classicRoot 'apps\web\.env.example'
$envLocal = Join-Path $classicRoot 'apps\web\.env.local'
$bun = 'C:\Users\Admin\.proto\shims\bun.exe'

if (-not (Test-Path -LiteralPath $bun)) {
    throw 'Bun is missing. Run C:\Users\Admin\.proto\bin\proto.exe use first.'
}

if (-not (Test-Path -LiteralPath $envLocal)) {
    Copy-Item -LiteralPath $envExample -Destination $envLocal
    Write-Host 'Created classic/apps/web/.env.local from the development defaults.'
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
