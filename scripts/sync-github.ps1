param(
  [string]$Message = "",
  [string]$RemoteUrl = ""
)

$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repo

try {
  if (-not (Test-Path -LiteralPath '.git')) {
    throw "This folder is not a Git repository yet. Run git init first."
  }

  $branch = (& git branch --show-current).Trim()
  if (-not $branch) {
    & git checkout -B main | Out-Host
  } elseif ($branch -ne 'main') {
    & git branch -M main | Out-Host
  }

  if ($RemoteUrl) {
    $existingRemote = (& git remote 2>$null) -contains 'origin'
    if ($existingRemote) {
      & git remote set-url origin $RemoteUrl
    } else {
      & git remote add origin $RemoteUrl
    }
  }

  $origin = ""
  if ((& git remote) -contains 'origin') {
    $origin = (& git remote get-url origin).Trim()
  }
  if (-not $origin) {
    Write-Host "GitHub remote is not configured."
    Write-Host "Create the Garment-Work repository on GitHub, then run:"
    Write-Host "powershell -ExecutionPolicy Bypass -File scripts\sync-github.ps1 -RemoteUrl https://github.com/YOUR_USERNAME/Garment-Work.git"
    exit 1
  }

  $userName = ""
  $userEmail = ""
  try { $userName = (& git config --get user.name).Trim() } catch {}
  try { $userEmail = (& git config --get user.email).Trim() } catch {}
  if (-not $userName) {
    & git config user.name "Garment EMS"
  }
  if (-not $userEmail) {
    & git config user.email "garment-ems@example.local"
  }

  $changes = & git status --short
  if (-not $changes) {
    Write-Host "No updates to sync."
    exit 0
  }

  Write-Host "Files to sync:"
  $changes | ForEach-Object { Write-Host "  $_" }

  & git add -A

  $staged = & git diff --cached --name-only
  if (-not $staged) {
    Write-Host "No staged source updates. They may all be ignored by .gitignore."
    exit 0
  }

  if (-not $Message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $Message = "Sync garment EMS updates $stamp"
  }

  & git commit -m $Message | Out-Host
  & git push -u origin main | Out-Host

  Write-Host "Synced to GitHub: $origin"
} finally {
  Pop-Location
}
