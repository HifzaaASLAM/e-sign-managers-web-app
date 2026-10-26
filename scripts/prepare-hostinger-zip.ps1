$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path (Split-Path -Parent $projectRoot) "esign-saas-hostinger.zip"
$staging = Join-Path $env:TEMP ("esign-saas-hostinger-" + [guid]::NewGuid().ToString("n"))

Write-Host "Staging project at: $staging"

New-Item -ItemType Directory -Path $staging | Out-Null

$excludeDirs = @(
  "node_modules",
  ".next",
  ".git",
  "out",
  "build",
  "dist",
  "scripts\.check-work2",
  "scripts\.check-work3",
  "scripts\.check-work4",
  "scripts\.check-work5"
)
# Never ship secrets. Hostinger file-replace deploys can wipe a server .env;
# keep secrets in hPanel → Environment Variables so they survive zip uploads.
$excludeFileNames = @(
  "*.zip",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  ".env.production"
)

function ShouldExcludeRelativePath([string]$relativePath) {
  $normalized = $relativePath -replace "\\", "/"
  $leaf = Split-Path -Leaf $normalized
  foreach ($pattern in $excludeFileNames) {
    if ($leaf -like $pattern) {
      return $true
    }
  }
  foreach ($dir in $excludeDirs) {
    $dirNorm = ($dir -replace "\\", "/")
    if ($normalized -eq $dirNorm -or $normalized.StartsWith("$dirNorm/")) {
      return $true
    }
  }
  return $false
}

Get-ChildItem -Path $projectRoot -Force | ForEach-Object {
  if (ShouldExcludeRelativePath $_.Name) {
    return
  }
  Copy-Item -Path $_.FullName -Destination (Join-Path $staging $_.Name) -Recurse -Force
}

Get-ChildItem -Path (Join-Path $staging "scripts") -Directory -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like ".check-work*" } |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

if (-not (Test-Path (Join-Path $staging "package.json"))) {
  throw "package.json missing from staged files."
}

if (-not (Test-Path (Join-Path $staging "app"))) {
  throw "app/ folder missing from staged files."
}

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Push-Location $staging
try {
  # Entries must be package.json, app/, etc. — NOT ./package.json (Hostinger rejects that).
  tar -a -cf $zipPath *
}
finally {
  Pop-Location
}

Remove-Item $staging -Recurse -Force

Write-Host ""
Write-Host "Created Hostinger upload zip:"
Write-Host $zipPath
Write-Host ""
Write-Host "hPanel settings:"
Write-Host "  Framework: Next.js (or Other if detection fails)"
Write-Host "  Node: 22.x"
Write-Host "  Root directory: leave empty (not ./)"
Write-Host "  Build: npm run build"
Write-Host "  Start: npm start"
Write-Host "  Output: .next"
Write-Host ""
Write-Host "IMPORTANT - after every zip upload, confirm Environment Variables still exist:"
Write-Host "  DATABASE_URL"
Write-Host "  DIRECT_URL   (if you use it)"
Write-Host "  NEXTAUTH_URL=https://sharehousemanagers.com"
Write-Host "  NEXTAUTH_SECRET"
Write-Host "  RESEND_API_KEY / EMAIL_FROM   (for emails)"
Write-Host "  MAKE_WEBHOOK_URL / PDF_API_KEY / etc. as needed"
Write-Host "Then Restart the Node.js app."
