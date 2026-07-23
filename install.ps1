[CmdletBinding()]
param([string]$Version = $env:VCONTEXT_VERSION, [string]$InstallDir = $env:VCONTEXT_INSTALL_DIR, [switch]$Force)
$ErrorActionPreference = 'Stop'
$Owner = 'VeguiDev'; $Repository = 'vcontext'
function Fail([string]$Message) { throw "vcontext installer: $Message" }
function Get-VContextExecutableVersion([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    $versionOutput = (& $Path --version 2>$null | Out-String).Trim()
    $versionExitCode = $LASTEXITCODE
    if ($versionExitCode -ne 0 -or $versionOutput -notmatch '^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?(\+[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$') { return $null }
    $helpOutput = (& $Path --help 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or $helpOutput -notmatch '(?im)^vcontext\b') { return $null }
    return $versionOutput
  } catch { return $null }
}
function Move-WithRetry([string]$Source, [string]$Destination) {
  $lastError = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { Move-Item -LiteralPath $Source -Destination $Destination -Force; return }
    catch { $lastError = $_; Start-Sleep -Milliseconds 250 }
  }
  throw $lastError
}
function Install-VContextExecutable([string]$Source, [string]$Destination, [switch]$AllowUnsafeOverwrite) {
  $sourceVersion = Get-VContextExecutableVersion $Source
  if ([string]::IsNullOrWhiteSpace($sourceVersion)) { Fail 'Downloaded executable could not run or is not VContext.' }
  $existingVersion = $null
  if (Test-Path -LiteralPath $Destination) {
    $existingVersion = Get-VContextExecutableVersion $Destination
    if ([string]::IsNullOrWhiteSpace($existingVersion) -and -not $AllowUnsafeOverwrite) {
      Fail "Existing file at $Destination is not a recognized VContext executable; use -Force to replace it."
    }
  }
  $directory = Split-Path -Parent $Destination
  $extension = [IO.Path]::GetExtension($Destination)
  $candidate = Join-Path $directory (".vcontext-install-" + [guid]::NewGuid() + $extension)
  $backup = Join-Path $directory (".vcontext-backup-" + [guid]::NewGuid() + $extension)
  $movedExisting = $false
  $installedCandidate = $false
  try {
    Copy-Item -LiteralPath $Source -Destination $candidate -Force
    if ([string]::IsNullOrWhiteSpace((Get-VContextExecutableVersion $candidate))) { Fail 'Staged executable could not run or is not VContext.' }
    if (-not [string]::IsNullOrWhiteSpace($existingVersion)) {
      Write-Host "● Updating existing VContext $existingVersion"
      try { & $Destination daemon stop --quiet 2>$null | Out-Null } catch {}
    }
    if (Test-Path -LiteralPath $Destination) {
      Move-WithRetry $Destination $backup
      $movedExisting = $true
    }
    Move-WithRetry $candidate $Destination
    $installedCandidate = $true
    $installedVersion = Get-VContextExecutableVersion $Destination
    if ([string]::IsNullOrWhiteSpace($installedVersion)) { Fail 'Installed executable could not run.' }
    if ($installedVersion -ne $sourceVersion) { Fail "Installed executable reported version $installedVersion instead of $sourceVersion." }
    if ($movedExisting -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Force }
    return $installedVersion
  } catch {
    if ($installedCandidate -and (Test-Path -LiteralPath $Destination)) { Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue }
    if ($movedExisting -and (Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $Destination)) {
      Move-WithRetry $backup $Destination
    }
    throw
  } finally {
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
  }
}
try {
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Windows x64 is required.' }
  if ([string]::IsNullOrWhiteSpace($Version)) { $Version = 'latest' }
  if ($Version -ne 'latest' -and $Version -notmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?(\+[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$') { Fail 'Version must be latest or a v-prefixed semantic version.' }
  $asset = 'vcontext-windows-x64.zip'
  $base = if ($Version -eq 'latest') { "https://github.com/$Owner/$Repository/releases/latest/download" } else { "https://github.com/$Owner/$Repository/releases/download/$Version" }
  if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\vcontext\bin' }
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("vcontext-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Write-Host 'vcontext installer'; Write-Host '● Detecting platform: Windows x64'; Write-Host "● Downloading $asset"
  $zip = Join-Path $temp $asset; $checksums = Join-Path $temp 'checksums.txt'
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $zip -MaximumRedirection 5
  Invoke-WebRequest -Uri "$base/vcontext-checksums.txt" -OutFile $checksums -MaximumRedirection 5
  $expected = ((Get-Content $checksums) | Where-Object { $_ -match "\s$asset$" } | Select-Object -First 1).Split()[0]
  if ([string]::IsNullOrWhiteSpace($expected)) { Fail 'Checksum entry is missing.' }
  if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { Fail 'Checksum verification failed.' }
  Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
  $source = Join-Path $temp 'vcontext.exe'; if (-not (Test-Path -LiteralPath $source)) { Fail 'Archive does not contain vcontext.exe.' }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null; $destination = Join-Path $InstallDir 'vcontext.exe'
  $installed = Install-VContextExecutable $source $destination -AllowUnsafeOverwrite:$Force
  $userPath = [Environment]::GetEnvironmentVariable('Path','User'); $parts = @($userPath -split ';' | Where-Object { $_ }); if ($parts -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable('Path', (($parts + $InstallDir) -join ';'), 'User') }; if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path += ";$InstallDir" }
  Write-Host "✓ vcontext $installed installed successfully in $InstallDir"
} finally { if ($temp -and (Test-Path $temp)) { Remove-Item -Recurse -Force $temp } }
