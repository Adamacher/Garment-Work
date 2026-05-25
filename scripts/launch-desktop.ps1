$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$repo = Join-Path $desktop 'garment-ems-app\garment-ems-app'
$errorLog = Join-Path $desktop 'garment_ems_launcher_error.txt'
$runLog = Join-Path $desktop 'garment_ems_launcher_run.log'
$targetLog = Join-Path $desktop 'garment_ems_launcher_last_target.txt'

function Write-LauncherError([string]$message) {
  Set-Content -LiteralPath $errorLog -Value $message -Encoding UTF8
  Write-Error $message
}

if (-not (Test-Path -LiteralPath (Join-Path $repo 'package.json'))) {
  Write-LauncherError "Source repo not found: $repo"
  exit 1
}

if (Test-Path -LiteralPath $errorLog) {
  Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue
}

$packageJsonPath = Join-Path $repo 'package.json'
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$appVersion = [string]$packageJson.version
$launchTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$distIndexPath = Join-Path $repo 'dist\index.html'

function Get-LatestWriteTime([string[]]$paths) {
  $latest = [datetime]::MinValue
  foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }
    $candidate = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate -and $candidate.LastWriteTime -gt $latest) {
      $latest = $candidate.LastWriteTime
    }
  }
  return $latest
}

function Test-RebuildRequired {
  if (-not (Test-Path -LiteralPath $distIndexPath)) {
    return $true
  }

  $distTime = (Get-Item -LiteralPath $distIndexPath).LastWriteTime
  $sourceTime = Get-LatestWriteTime @(
    (Join-Path $repo 'src'),
    (Join-Path $repo 'electron'),
    (Join-Path $repo 'scripts'),
    $packageJsonPath,
    (Join-Path $repo 'vite.config.js'),
    (Join-Path $repo 'vite.config.mjs'),
    (Join-Path $repo 'vite.config.cjs')
  )

  return $sourceTime -gt $distTime
}

@(
  "TargetFolder=$repo"
  'LaunchMode=DesktopSourceRepo'
  "Version=$appVersion"
  "LaunchedAt=$launchTime"
) | Set-Content -LiteralPath $targetLog -Encoding UTF8

@(
  "==== $launchTime ===="
  "Target folder: $repo"
  "Version: $appVersion"
) | Add-Content -LiteralPath $runLog -Encoding UTF8

$killTargets = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('electron.exe', 'Garment-EMS.exe') -or
  $_.ExecutablePath -like 'D:\*1.0.22\*' -or
  $_.ExecutablePath -like "$desktop\服装采购生产管理系统-*\*"
}

foreach ($item in $killTargets) {
  try {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop
  } catch {}
}

Start-Sleep -Milliseconds 500

$rebuildRequired = Test-RebuildRequired
Add-Content -LiteralPath $runLog -Value ("Build status: " + ($(if ($rebuildRequired) { 'rebuild required' } else { 'reuse existing dist' }))) -Encoding UTF8

if ($rebuildRequired) {
  $buildSucceeded = $false
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    Add-Content -LiteralPath $runLog -Value "Build attempt $attempt" -Encoding UTF8
    Push-Location $repo
    try {
      & cmd.exe /c "npm.cmd run build >> `"$runLog`" 2>&1"
      if ($LASTEXITCODE -eq 0) {
        $buildSucceeded = $true
        break
      }
    } finally {
      Pop-Location
    }

    Start-Sleep -Seconds 2
  }

  if (-not $buildSucceeded) {
    Write-LauncherError "Desktop source test launcher failed.`nTarget folder: $repo`nVersion: $appVersion`nTime: $launchTime`nSee run log: $runLog"
    exit 1
  }
}

$electronExe = Join-Path $repo 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
  Write-LauncherError "Electron runtime not found: $electronExe"
  exit 1
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electronExe -ArgumentList '.' -WorkingDirectory $repo
exit 0
