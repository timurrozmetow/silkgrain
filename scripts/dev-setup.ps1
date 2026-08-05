<#
.SYNOPSIS
    Provisions SilkGrain's local development services without Docker.

.DESCRIPTION
    The development machine has no Docker and no administrator rights, so the four services
    from docker/docker-compose.dev.yml are installed as portable binaries under .services/:

        MySQL    8.0.42   127.0.0.1:3307   (XAMPP's MariaDB keeps 3306)
        Redis    7.4.5    127.0.0.1:6379
        Mailpit  latest   SMTP 1025, web UI http://localhost:8025
        MinIO    latest   S3 9000, console http://localhost:9001

    Everything lives inside the repository under .services/ (gitignored) and nothing is
    written to the registry, PATH or Program Files. Delete .services/ to start over.

.PARAMETER Action
    install  Download, unpack and initialise everything, then start it. Safe to re-run.
    start    Start services that are installed but not running.
    stop     Stop services started by this script.
    status   Report what is installed and what is listening.
    remove   Stop everything and delete .services/.

.PARAMETER Only
    Restrict the action to a subset: mysql, redis, mailpit, minio.

.EXAMPLE
    pnpm setup:services
.EXAMPLE
    powershell -File scripts/dev-setup.ps1 -Action status
.EXAMPLE
    powershell -File scripts/dev-setup.ps1 -Action start -Only mysql,redis

.NOTES
    Keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less files as ANSI, so a
    UTF-8 dash or quote turns into bytes it parses as string delimiters and the script
    fails with confusing syntax errors far from the offending line.
#>
[CmdletBinding()]
param(
    [ValidateSet('install', 'start', 'stop', 'status', 'remove')]
    [string]$Action = 'install',

    [ValidateSet('mysql', 'redis', 'mailpit', 'minio')]
    [string[]]$Only,

    # Local-only credential for the portable MySQL on 127.0.0.1:3307. Deliberately not the
    # password of any other server on this machine, so committing .env.example leaks nothing.
    [string]$MysqlRootPassword = 'silkgrain_dev_only'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --------------------------------------------------------------------------------------
# Paths and versions
# --------------------------------------------------------------------------------------

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServicesDir = Join-Path $RepoRoot '.services'
$DownloadDir = Join-Path $ServicesDir '_downloads'
$RunDir = Join-Path $ServicesDir '_run'

$MysqlVersion = '8.0.42'
$RedisVersion = '7.4.5'

$Sources = @{
    mysql   = "https://cdn.mysql.com/archives/mysql-8.0/mysql-$MysqlVersion-winx64.zip"
    redis   = "https://github.com/redis-windows/redis-windows/releases/download/$RedisVersion/Redis-$RedisVersion-Windows-x64-msys2.zip"
    mailpit = 'https://github.com/axllent/mailpit/releases/latest/download/mailpit-windows-amd64.zip'
    minio   = 'https://dl.min.io/server/minio/release/windows-amd64/minio.exe'
}

$Ports = @{ mysql = 3307; redis = 6379; mailpit = 1025; minio = 9000 }

$AllServices = @('mysql', 'redis', 'mailpit', 'minio')
$Selected = if ($Only) { $Only } else { $AllServices }

# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "    $Message" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

function Invoke-Native {
    <#
        Runs a native executable and returns its exit code plus combined output.

        Windows PowerShell 5.1 wraps every stderr line from a native command in an
        ErrorRecord. With $ErrorActionPreference = 'Stop' that aborts the script even when
        the program succeeded - and mysqld writes its normal progress to stderr. So the
        preference is relaxed for the duration of the call and success is judged by the
        exit code, which is the only reliable signal here.
    #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $FilePath @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if (-not $AllowFailure -and $code -ne 0) {
        $name = Split-Path $FilePath -Leaf
        throw "$name exited with code $code`n$($output -join [Environment]::NewLine)"
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Test-PortOpen {
    param([int]$Port)
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $connect.AsyncWaitHandle.WaitOne(400)
        if ($ok) { $client.EndConnect($connect) }
        $client.Close()
        return $ok
    }
    catch { return $false }
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSeconds = 60, [string]$Name = 'service')
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortOpen -Port $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not start listening on port $Port within $TimeoutSeconds seconds."
}

function Get-Archive {
    param([string]$Url, [string]$Destination)
    if (Test-Path $Destination) {
        Write-Note "cached $(Split-Path $Destination -Leaf)"
        return
    }
    Write-Note "downloading $Url"
    $temp = "$Destination.part"
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'   # ~10x faster for large files
    try {
        Invoke-WebRequest -Uri $Url -OutFile $temp -UseBasicParsing -TimeoutSec 900
        Move-Item -LiteralPath $temp -Destination $Destination -Force
    }
    finally {
        $ProgressPreference = $previous
        if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    }
    Write-Ok "downloaded $(Split-Path $Destination -Leaf) ($([math]::Round((Get-Item $Destination).Length / 1MB, 1)) MB)"
}

function Expand-Once {
    param([string]$Archive, [string]$Target)
    if (Test-Path $Target) { return }
    $staging = "$Target.staging"
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Expand-Archive -LiteralPath $Archive -DestinationPath $staging -Force
    # Collapse a single wrapper directory, so layouts are identical across archives.
    $entries = @(Get-ChildItem -LiteralPath $staging)
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
        Move-Item -LiteralPath $entries[0].FullName -Destination $Target
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    else {
        Move-Item -LiteralPath $staging -Destination $Target
    }
}

function Get-PidFile { param([string]$Name) Join-Path $RunDir "$Name.pid" }

function Get-RunningProcess {
    param([string]$Name)
    $pidFile = Get-PidFile $Name
    if (-not (Test-Path $pidFile)) { return $null }
    $processId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    return Get-Process -Id $processId -ErrorAction SilentlyContinue
}

function Start-DevService {
    # Named Start-DevService, not Start-Service: the latter is a built-in cmdlet and
    # shadowing it here would make this script confusing to read and to debug.
    param([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory)

    if (Get-RunningProcess $Name) { Write-Note "$Name already running"; return }
    if (Test-PortOpen -Port $Ports[$Name]) {
        Write-Warn "port $($Ports[$Name]) is already in use - assuming an external $Name and leaving it alone"
        return
    }

    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $RunDir "$Name.out.log") `
        -RedirectStandardError (Join-Path $RunDir "$Name.err.log")
    Set-Content -LiteralPath (Get-PidFile $Name) -Value $proc.Id -Encoding ascii
    Wait-ForPort -Port $Ports[$Name] -Name $Name | Out-Null
    Write-Ok "$Name listening on 127.0.0.1:$($Ports[$Name])"
}

function Stop-DevService {
    param([string]$Name)
    $proc = Get-RunningProcess $Name
    if (-not $proc) { Write-Note "$Name not running"; return }
    Stop-Process -Id $proc.Id -Force
    Remove-Item -LiteralPath (Get-PidFile $Name) -Force -ErrorAction SilentlyContinue
    Write-Ok "$Name stopped"
}

# --------------------------------------------------------------------------------------
# MySQL
# --------------------------------------------------------------------------------------

$MysqlHome = Join-Path $ServicesDir 'mysql'
$MysqlData = Join-Path $ServicesDir 'mysql-data'
$MysqlIni = Join-Path $ServicesDir 'my.ini'

function Install-Mysql {
    Write-Step "MySQL $MysqlVersion"
    $archive = Join-Path $DownloadDir "mysql-$MysqlVersion-winx64.zip"
    Get-Archive -Url $Sources.mysql -Destination $archive
    Expand-Once -Archive $archive -Target $MysqlHome

    if (-not (Test-Path $MysqlIni)) {
        # Settings mirror docker-compose.dev.yml exactly. STRICT_TRANS_TABLES matters most:
        # without it MySQL silently truncates instead of rejecting bad data.
        @"
[mysqld]
basedir=$($MysqlHome -replace '\\', '/')
datadir=$($MysqlData -replace '\\', '/')
port=$($Ports.mysql)
bind-address=127.0.0.1
sql-mode=ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-time-zone='+00:00'
max_connections=151
innodb_buffer_pool_size=256M

[client]
port=$($Ports.mysql)
host=127.0.0.1
default-character-set=utf8mb4
"@ | Set-Content -LiteralPath $MysqlIni -Encoding ascii
        Write-Ok 'wrote my.ini'
    }

    $mysqld = Join-Path $MysqlHome 'bin\mysqld.exe'
    if (-not (Test-Path $MysqlData)) {
        Write-Note 'initialising data directory (takes ~30s)'
        Invoke-Native -FilePath $mysqld -Arguments @(
            "--defaults-file=$MysqlIni", '--initialize-insecure', '--console'
        ) | Out-Null
        if (-not (Test-Path $MysqlData)) { throw 'MySQL initialisation produced no data directory.' }
        Write-Ok 'data directory initialised'
    }

    Start-Mysql

    $mysqlCli = Join-Path $MysqlHome 'bin\mysql.exe'
    # --initialize-insecure leaves root without a password; set it, then create the schemas.
    $probe = Invoke-Native -FilePath $mysqlCli -AllowFailure -Arguments @(
        "--defaults-file=$MysqlIni", '-u', 'root', '--skip-password', '-e', 'SELECT 1'
    )
    if ($probe.ExitCode -eq 0) {
        Write-Note 'setting root password'
        Invoke-Native -FilePath $mysqlCli -Arguments @(
            "--defaults-file=$MysqlIni", '-u', 'root', '--skip-password',
            '-e', "ALTER USER 'root'@'localhost' IDENTIFIED BY '$MysqlRootPassword'; FLUSH PRIVILEGES;"
        ) | Out-Null
        Write-Ok 'root password set'
    }
    else {
        Write-Note 'root password already set'
    }

    $create = 'CREATE DATABASE IF NOT EXISTS `silkgrain` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;' +
    ' CREATE DATABASE IF NOT EXISTS `silkgrain_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
    Invoke-Native -FilePath $mysqlCli -Arguments @(
        "--defaults-file=$MysqlIni", '-u', 'root', "-p$MysqlRootPassword", '-e', $create
    ) | Out-Null
    Write-Ok 'databases silkgrain and silkgrain_test ready'
}

function Start-Mysql {
    Start-DevService -Name 'mysql' -FilePath (Join-Path $MysqlHome 'bin\mysqld.exe') `
        -ArgumentList @("--defaults-file=$MysqlIni") -WorkingDirectory $MysqlHome
}

function Stop-Mysql {
    $proc = Get-RunningProcess 'mysql'
    if (-not $proc) { Write-Note 'mysql not running'; return }
    # Prefer a clean shutdown so InnoDB does not have to recover on next start.
    $admin = Join-Path $MysqlHome 'bin\mysqladmin.exe'
    if (Test-Path $admin) {
        Invoke-Native -FilePath $admin -AllowFailure -Arguments @(
            "--defaults-file=$MysqlIni", '-u', 'root', "-p$MysqlRootPassword", 'shutdown'
        ) | Out-Null
        Start-Sleep -Seconds 2
    }
    Stop-DevService 'mysql'
}

# --------------------------------------------------------------------------------------
# Redis
# --------------------------------------------------------------------------------------

$RedisHome = Join-Path $ServicesDir 'redis'

# The Windows build of Redis is compiled against msys2 and resolves paths as POSIX. Handing
# it "C:\...\redis.conf" makes it look for "/<msys-root>/C:\...", so the config lives next to
# redis-server.exe and is passed as a bare relative name, with the working directory set to
# match. `dir` inside the config is relative for the same reason.
$RedisConfName = 'silkgrain.conf'

function Install-Redis {
    Write-Step "Redis $RedisVersion"
    $archive = Join-Path $DownloadDir "redis-$RedisVersion.zip"
    Get-Archive -Url $Sources.redis -Destination $archive
    Expand-Once -Archive $archive -Target $RedisHome

    $confPath = Join-Path $RedisHome $RedisConfName
    if (-not (Test-Path $confPath)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $RedisHome 'data') | Out-Null
        # noeviction is required by BullMQ: evicting a job key would silently drop work.
        @"
port $($Ports.redis)
bind 127.0.0.1
dir ./data
appendonly yes
maxmemory-policy noeviction
save 900 1
"@ | Set-Content -LiteralPath $confPath -Encoding ascii
        Write-Ok "wrote $RedisConfName"
    }
    Start-Redis
}

function Get-RedisServerPath {
    $exe = Get-ChildItem -LiteralPath $RedisHome -Filter 'redis-server*.exe' -Recurse |
        Select-Object -First 1
    if (-not $exe) { throw "redis-server.exe not found under $RedisHome" }
    return $exe
}

function Start-Redis {
    $exe = Get-RedisServerPath
    Start-DevService -Name 'redis' -FilePath $exe.FullName -ArgumentList @($RedisConfName) `
        -WorkingDirectory $exe.DirectoryName
}

# --------------------------------------------------------------------------------------
# Mailpit
# --------------------------------------------------------------------------------------

$MailpitHome = Join-Path $ServicesDir 'mailpit'

function Install-Mailpit {
    Write-Step 'Mailpit'
    $archive = Join-Path $DownloadDir 'mailpit-windows-amd64.zip'
    Get-Archive -Url $Sources.mailpit -Destination $archive
    if (-not (Test-Path $MailpitHome)) {
        Expand-Archive -LiteralPath $archive -DestinationPath $MailpitHome -Force
    }
    Start-Mailpit
    Write-Note 'inbox: http://localhost:8025'
}

function Start-Mailpit {
    $exe = Get-ChildItem -LiteralPath $MailpitHome -Filter 'mailpit.exe' -Recurse |
        Select-Object -First 1
    if (-not $exe) { throw "mailpit.exe not found under $MailpitHome" }
    Start-DevService -Name 'mailpit' -FilePath $exe.FullName `
        -ArgumentList @('--smtp', "127.0.0.1:$($Ports.mailpit)", '--listen', '127.0.0.1:8025') `
        -WorkingDirectory $exe.DirectoryName
}

# --------------------------------------------------------------------------------------
# MinIO
# --------------------------------------------------------------------------------------

$MinioHome = Join-Path $ServicesDir 'minio'
$MinioData = Join-Path $ServicesDir 'minio-data'

function Install-Minio {
    Write-Step 'MinIO'
    New-Item -ItemType Directory -Force -Path $MinioHome, $MinioData | Out-Null
    $exe = Join-Path $MinioHome 'minio.exe'
    if (-not (Test-Path $exe)) {
        Get-Archive -Url $Sources.minio -Destination $exe
    }
    Start-Minio
    Write-Note 'console: http://localhost:9001 (silkgrain / silkgrain-dev-secret)'
}

function Start-Minio {
    $exe = Join-Path $MinioHome 'minio.exe'
    if (-not (Test-Path $exe)) { throw "minio.exe not found at $exe" }
    $env:MINIO_ROOT_USER = 'silkgrain'
    $env:MINIO_ROOT_PASSWORD = 'silkgrain-dev-secret'
    Start-DevService -Name 'minio' -FilePath $exe `
        -ArgumentList @('server', $MinioData, '--address', "127.0.0.1:$($Ports.minio)", '--console-address', '127.0.0.1:9001') `
        -WorkingDirectory $MinioHome
}

# --------------------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------------------

function Invoke-Install {
    New-Item -ItemType Directory -Force -Path $ServicesDir, $DownloadDir, $RunDir | Out-Null
    if ($Selected -contains 'mysql') { Install-Mysql }
    if ($Selected -contains 'redis') { Install-Redis }
    if ($Selected -contains 'mailpit') { Install-Mailpit }
    if ($Selected -contains 'minio') { Install-Minio }
    Write-Host ''
    Invoke-Status
}

function Invoke-Start {
    if ($Selected -contains 'mysql') { Write-Step 'MySQL'; Start-Mysql }
    if ($Selected -contains 'redis') { Write-Step 'Redis'; Start-Redis }
    if ($Selected -contains 'mailpit') { Write-Step 'Mailpit'; Start-Mailpit }
    if ($Selected -contains 'minio') { Write-Step 'MinIO'; Start-Minio }
}

function Invoke-Stop {
    if ($Selected -contains 'minio') { Stop-DevService 'minio' }
    if ($Selected -contains 'mailpit') { Stop-DevService 'mailpit' }
    if ($Selected -contains 'redis') { Stop-DevService 'redis' }
    if ($Selected -contains 'mysql') { Stop-Mysql }
}

function Invoke-Status {
    Write-Step 'Status'
    foreach ($name in $AllServices) {
        $listening = Test-PortOpen -Port $Ports[$name]
        $proc = Get-RunningProcess $name
        $state = if ($listening -and $proc) { 'running' }
        elseif ($listening) { 'running (external)' }
        else { 'stopped' }
        $colour = if ($listening) { 'Green' } else { 'DarkGray' }
        Write-Host ("    {0,-8} {1,-20} 127.0.0.1:{2}" -f $name, $state, $Ports[$name]) -ForegroundColor $colour
    }
    Write-Host ''
    Write-Note 'Mailpit inbox  http://localhost:8025'
    Write-Note 'MinIO console  http://localhost:9001'
}

function Invoke-Remove {
    Invoke-Stop
    if (Test-Path $ServicesDir) {
        Remove-Item -LiteralPath $ServicesDir -Recurse -Force
        Write-Ok 'removed .services/'
    }
}

switch ($Action) {
    'install' { Invoke-Install }
    'start' { Invoke-Start }
    'stop' { Invoke-Stop }
    'status' { Invoke-Status }
    'remove' { Invoke-Remove }
}
