# Build the plugin container image and save it as a .tar.gz in ./dist
#
# Usage:
#   pwsh scripts/build.ps1                  # uses version from package.json
#   pwsh scripts/build.ps1 -Version 0.2.1   # override version
#   pwsh scripts/build.ps1 -Engine podman   # use podman instead of docker

[CmdletBinding()]
param(
    [string]$Version = "",
    [ValidateSet("docker", "podman")]
    [string]$Engine = "docker",
    [string]$ImageName = "hmip-hcu-fusionsolar"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Version) {
    $pkg = Get-Content -Raw "$root\package.json" | ConvertFrom-Json
    $Version = $pkg.version
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$tag = "${ImageName}:${Version}"
$out = Join-Path $dist "${ImageName}-${Version}.tar.gz"

Write-Host "[*] Engine:  $Engine"
Write-Host "[*] Tag:     $tag"
Write-Host "[*] Output:  $out"
Write-Host ""

# Build for HCU2 (ARM64). Requires buildx or qemu-user-static on x86 hosts.
& $Engine buildx build --platform linux/arm64 -t $tag --load .
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

Write-Host ""
Write-Host "[*] Saving image to $out"
if (Test-Path $out) { Remove-Item $out -Force }

# Save image to a temp tar then gzip via .NET so we don't depend on gzip.exe
$tmp = "$out.tmp"
& $Engine save $tag -o $tmp
if ($LASTEXITCODE -ne 0) { throw "Image save failed" }

$inStream = [System.IO.File]::OpenRead($tmp)
$outStream = [System.IO.File]::Create($out)
$gz = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
$inStream.CopyTo($gz)
$gz.Close()
$outStream.Close()
$inStream.Close()
Remove-Item $tmp -Force

$size = (Get-Item $out).Length / 1MB
Write-Host ""
Write-Host ("[OK] Built {0:N1} MB at {1}" -f $size, $out) -ForegroundColor Green
