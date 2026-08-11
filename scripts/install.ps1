[CmdletBinding()]
param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:ProgramData\MCACS",
    [string]$MinecraftDir = "",
    [string]$EngineHost = "127.0.0.1",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$repository = "wzbis666/MCACS-V2.0"

if (-not $NoStart) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker Desktop with Docker Compose is required."
    }
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose is not available." }
}

if ($Version -eq "latest") {
    $assetBase = "https://github.com/$repository/releases/latest/download"
    $imageVersion = "latest"
} else {
    if (-not $Version.StartsWith("v")) { $Version = "v$Version" }
    $assetBase = "https://github.com/$repository/releases/download/$Version"
    $imageVersion = $Version.Substring(1)
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ("mcacs-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $downloadDir | Out-Null

try {
    $assets = @("compose.yml", "penalty-config.yml", "MCACS-Paper.jar", "SHA256SUMS.txt")
    foreach ($asset in $assets) {
        Write-Host "Downloading $asset..."
        Invoke-WebRequest -UseBasicParsing -Uri "$assetBase/$asset" -OutFile (Join-Path $downloadDir $asset)
    }

    $checksumLines = Get-Content (Join-Path $downloadDir "SHA256SUMS.txt")
    foreach ($asset in @("compose.yml", "penalty-config.yml", "MCACS-Paper.jar")) {
        $line = $checksumLines | Where-Object { $_ -match "^[0-9a-fA-F]{64}  $([regex]::Escape($asset))$" } | Select-Object -First 1
        if (-not $line) { throw "No checksum published for $asset" }
        $expected = ($line -split "  ")[0].ToLowerInvariant()
        $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $downloadDir $asset)).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "Checksum verification failed for $asset" }
        Write-Host "$asset checksum verified."
    }

    Copy-Item (Join-Path $downloadDir "compose.yml") (Join-Path $InstallDir "compose.yml") -Force
    $penaltyConfig = Join-Path $InstallDir "penalty-config.yml"
    if (Test-Path $penaltyConfig) {
        Copy-Item (Join-Path $downloadDir "penalty-config.yml") "$penaltyConfig.dist" -Force
        Write-Host "Existing penalty-config.yml preserved; new default saved as penalty-config.yml.dist."
    } else {
        Copy-Item (Join-Path $downloadDir "penalty-config.yml") $penaltyConfig
    }
    $localJar = Join-Path $InstallDir "MCACS-Paper.jar"
    Copy-Item (Join-Path $downloadDir "MCACS-Paper.jar") $localJar -Force

    $envFile = Join-Path $InstallDir ".env"
    if (-not (Test-Path $envFile)) {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $authSecret = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
        @"
MCACS_VERSION=$imageVersion
ACS_AUTH_SECRET=$authSecret
ACS_HTTP_PORT=55210
ACS_WS_PORT=55211
ACS_MODE=dashboard
ACS_PRESET=survival
TZ=Asia/Shanghai
"@ | Set-Content -Encoding ASCII $envFile
    } else {
        $envLines = @(Get-Content $envFile)
        $versionFound = $false
        $envLines = @($envLines | ForEach-Object {
            if ($_ -match '^MCACS_VERSION=') {
                $versionFound = $true
                "MCACS_VERSION=$imageVersion"
            } else {
                $_
            }
        })
        if (-not $versionFound) { $envLines += "MCACS_VERSION=$imageVersion" }
        $envLines | Set-Content -Encoding ASCII $envFile
        $authLine = $envLines | Where-Object { $_ -match '^ACS_AUTH_SECRET=' } | Select-Object -Last 1
        $authSecret = if ($authLine) { $authLine.Substring("ACS_AUTH_SECRET=".Length) } else { "" }
        if ([string]::IsNullOrWhiteSpace($authSecret)) { throw "$envFile must define a non-empty ACS_AUTH_SECRET." }
        Write-Host "Existing .env preserved; MCACS_VERSION updated to $imageVersion."
    }

    if ($authSecret -notmatch '^[A-Za-z0-9._-]+$') {
        throw "ACS_AUTH_SECRET may contain only letters, numbers, dot, underscore, and hyphen."
    }

    $envValues = @{}
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') { $envValues[$matches[1]] = $matches[2] }
    }
    $httpPort = if ($envValues.ContainsKey("ACS_HTTP_PORT")) { $envValues["ACS_HTTP_PORT"] } else { "55210" }
    $wsPort = if ($envValues.ContainsKey("ACS_WS_PORT")) { $envValues["ACS_WS_PORT"] } else { "55211" }
    if ($httpPort -notmatch '^\d+$' -or $wsPort -notmatch '^\d+$') {
        throw "ACS_HTTP_PORT and ACS_WS_PORT must be numeric."
    }

    $pluginTarget = $localJar
    if (-not [string]::IsNullOrWhiteSpace($MinecraftDir)) {
        $pluginsDir = Join-Path $MinecraftDir "plugins"
        $configDir = Join-Path $pluginsDir "AntiCheatMonitor"
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
        $pluginTarget = Join-Path $pluginsDir "MCACS-Paper.jar"
        Copy-Item (Join-Path $downloadDir "MCACS-Paper.jar") $pluginTarget -Force
        $pluginConfig = Join-Path $configDir "config.yml"
        if (-not (Test-Path $pluginConfig)) {
            @"
ws-uri: "ws://${EngineHost}:${wsPort}/spigot"
auth-token: "$authSecret"
server-name: "main-server"
sample-interval: 50
"@ | Set-Content -Encoding UTF8 $pluginConfig
        } else {
            Write-Host "Existing Paper plugin config preserved: $pluginConfig"
        }
    }

    if (-not $NoStart) {
        Push-Location $InstallDir
        try {
            & docker compose --env-file .env -f compose.yml pull
            if ($LASTEXITCODE -ne 0) { throw "Unable to pull the MCACS image." }
            & docker compose --env-file .env -f compose.yml up -d
            if ($LASTEXITCODE -ne 0) { throw "Unable to start MCACS." }
        } finally {
            Pop-Location
        }

        $healthy = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:${httpPort}/api/health" | Out-Null
                $healthy = $true
                break
            } catch {
                Start-Sleep -Seconds 2
            }
        }
        if (-not $healthy) { throw "Engine did not become healthy. Run docker compose logs in $InstallDir." }
    }

    Write-Host ""
    Write-Host "MCACS installation complete."
    Write-Host "  Engine files: $InstallDir"
    Write-Host "  Paper plugin: $pluginTarget"
    Write-Host "  Panel:        http://127.0.0.1:${httpPort}/?token=$authSecret"
    Write-Host "  WebSocket:    ws://${EngineHost}:${wsPort}/spigot"
    Write-Host "Keep $envFile private and restart Paper after replacing the plugin JAR."
} finally {
    Remove-Item -LiteralPath $downloadDir -Recurse -Force -ErrorAction SilentlyContinue
}
