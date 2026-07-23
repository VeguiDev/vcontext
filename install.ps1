[CmdletBinding()]
param([string]$Version = $env:VCONTEXT_VERSION, [string]$InstallDir = $env:VCONTEXT_INSTALL_DIR, [switch]$Force)
$ErrorActionPreference = 'Stop'
$Owner = 'VeguiDev'; $Repository = 'vcontext'
function Fail([string]$Message) { throw "vcontext installer: $Message" }
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
  if ((Test-Path $destination) -and -not $Force) { Fail 'vcontext already exists; use -Force.' }; Copy-Item -LiteralPath $source -Destination $destination -Force
  $userPath = [Environment]::GetEnvironmentVariable('Path','User'); $parts = @($userPath -split ';' | Where-Object { $_ }); if ($parts -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable('Path', (($parts + $InstallDir) -join ';'), 'User') }; if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path += ";$InstallDir" }
  $installed = & $destination --version; if ($LASTEXITCODE -ne 0) { Fail 'Installed executable could not run.' }; Write-Host "✓ vcontext $installed installed successfully in $InstallDir"
} finally { if ($temp -and (Test-Path $temp)) { Remove-Item -Recurse -Force $temp } }