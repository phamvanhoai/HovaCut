$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$proto = 'C:\Users\Admin\.proto\bin\proto.exe'
$moon = 'C:\Users\Admin\.proto\shims\moon.exe'

Push-Location $workspaceRoot
try {
    & $proto use
    if ($LASTEXITCODE -ne 0) { throw 'proto use failed.' }
    & $moon run web:dev
} finally {
    Pop-Location
}
