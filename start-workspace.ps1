param(
    [ValidateSet("review", "learning", "bitlang", "positions", "dashboard")]
    [string]$Page = "learning",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Join-Path $workspaceRoot "web"
$runtimeRoot = Join-Path $workspaceRoot ".run"
$backendUrl = "http://127.0.0.1:8765/api/health"

function Get-ExpectedBackendVersionNeedle {
    $serverPath = Join-Path $workspaceRoot "study_server.py"
    $match = Select-String -LiteralPath $serverPath -Pattern '^\s*API_VERSION\s*=\s*(\d+)\s*$' |
        Select-Object -First 1
    if (-not $match) {
        throw "无法从 study_server.py 读取 API_VERSION"
    }
    $version = $match.Matches[0].Groups[1].Value
    return '"version": ' + $version
}

$expectedBackendVersion = Get-ExpectedBackendVersionNeedle
$frontendBaseUrl = "http://127.0.0.1:3000/"
$frontendUrl = if ($Page -eq "review") {
    "${frontendBaseUrl}?tab=review"
} elseif ($Page -eq "bitlang") {
    "${frontendBaseUrl}?tab=bitlang"
} elseif ($Page -eq "positions") {
    "${frontendBaseUrl}?tab=positions"
} elseif ($Page -eq "dashboard") {
    "${frontendBaseUrl}?tab=positions&view=dashboard"
} else {
    $frontendBaseUrl
}

function Test-Endpoint {
    param(
        [string]$Uri,
        [string]$ExpectedText
    )
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
        return $response.StatusCode -eq 200 -and
            $response.Content.Contains($ExpectedText)
    } catch {
        return $false
    }
}

function Wait-Endpoint {
    param(
        [string]$Uri,
        [string]$ExpectedText,
        [int]$TimeoutSeconds = 30
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Endpoint -Uri $Uri -ExpectedText $ExpectedText) {
            return
        }
        Start-Sleep -Milliseconds 300
    }
    throw "服务启动超时：$Uri"
}

function Stop-OwnedProcess {
    param(
        [AllowNull()]
        [System.Diagnostics.Process]$Process
    )
    if ($null -eq $Process -or $Process.HasExited) {
        return
    }
    & taskkill.exe /PID $Process.Id /T /F *> $null
}

function Stop-StaleWorkspaceBackend {
    $listener = Get-NetTCPConnection `
        -LocalAddress "127.0.0.1" `
        -LocalPort 8765 `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) {
        return
    }

    $processInfo = Get-CimInstance `
        -ClassName Win32_Process `
        -Filter "ProcessId = $($listener.OwningProcess)" `
        -ErrorAction SilentlyContinue
    $normalizedCommandLine = [string]$processInfo.CommandLine
    $normalizedCommandLine = $normalizedCommandLine.Replace("\", "/").ToLowerInvariant()
    $normalizedWorkspace = $workspaceRoot.Replace("\", "/").ToLowerInvariant()
    $isWorkspaceBackend = $normalizedCommandLine.Contains(
        "$normalizedWorkspace/study_server.py"
    ) -or (
        $processInfo.Name -like "python*" -and
        $normalizedCommandLine.Contains("study_server.py")
    )
    if ($isWorkspaceBackend) {
        Write-Host "检测到当前项目的旧版数据服务，正在重新加载..." -ForegroundColor Yellow
        Stop-Process -Id $listener.OwningProcess -Force
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (
            [DateTime]::UtcNow -lt $deadline -and
            (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)
        ) {
            Start-Sleep -Milliseconds 100
        }
        return
    }

    throw "端口 8765 被其他程序占用，请先关闭 PID $($listener.OwningProcess)。"
}

$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
}
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $pythonCommand) {
    throw "未找到 Python。请安装 Python 3，并确保 python 命令可用。"
}
if (-not $npmCommand) {
    throw "未找到 npm。请安装 Node.js，并确保 npm 命令可用。"
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

& $pythonCommand.Source -c "import ccxt, cryptography, tzdata; assert tuple(map(int, ccxt.__version__.split('.')[:3])) >= (4, 5, 56)" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "正在安装或更新后端 Python 依赖..." -ForegroundColor Yellow
    & $pythonCommand.Source -m pip install -r (Join-Path $workspaceRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "后端 Python 依赖安装失败。"
    }
}

if (-not (Test-Path (Join-Path $webRoot "node_modules"))) {
    Write-Host "首次运行，正在安装前端依赖..." -ForegroundColor Yellow
    Push-Location $webRoot
    try {
        & $npmCommand.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "前端依赖安装失败。"
        }
    } finally {
        Pop-Location
    }
}

$backendProcess = $null
$frontendProcess = $null

try {
    if (Test-Endpoint -Uri $backendUrl -ExpectedText $expectedBackendVersion) {
        Write-Host "后端已经运行，直接复用 8765 端口。" -ForegroundColor DarkGray
    } else {
        Stop-StaleWorkspaceBackend
        Write-Host "正在启动数据服务..." -ForegroundColor Cyan
        $backendProcess = Start-Process `
            -FilePath $pythonCommand.Source `
            -ArgumentList @("study_server.py") `
            -WorkingDirectory $workspaceRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $runtimeRoot "backend.out.log") `
            -RedirectStandardError (Join-Path $runtimeRoot "backend.err.log") `
            -PassThru
        Wait-Endpoint -Uri $backendUrl -ExpectedText $expectedBackendVersion
    }

    if (Test-Endpoint -Uri $frontendBaseUrl -ExpectedText "TiaBTC Workspace") {
        Write-Host "前端已经运行，直接复用 3000 端口。" -ForegroundColor DarkGray
    } else {
        Write-Host "正在启动复盘界面..." -ForegroundColor Cyan
        $frontendProcess = Start-Process `
            -FilePath $npmCommand.Source `
            -ArgumentList @(
                "run", "dev", "--",
                "--host", "127.0.0.1",
                "--port", "3000",
                "--strictPort"
            ) `
            -WorkingDirectory $webRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $runtimeRoot "frontend.out.log") `
            -RedirectStandardError (Join-Path $runtimeRoot "frontend.err.log") `
            -PassThru
        Wait-Endpoint `
            -Uri $frontendBaseUrl `
            -ExpectedText "TiaBTC Workspace"
    }

    Write-Host ""
    Write-Host "工作台已经启动：$frontendUrl" -ForegroundColor Green
    Write-Host "关闭本窗口或按 Ctrl+C，将停止本次启动的服务。" -ForegroundColor DarkGray
    if (-not $NoBrowser) {
        Start-Process $frontendUrl
    }

    if ($null -eq $backendProcess -and $null -eq $frontendProcess) {
        return
    }

    while ($true) {
        if ($backendProcess -and $backendProcess.HasExited) {
            throw "数据服务意外退出，请查看 .run/backend.err.log"
        }
        if ($frontendProcess -and $frontendProcess.HasExited) {
            throw "前端服务意外退出，请查看 .run/frontend.err.log"
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Stop-OwnedProcess -Process $frontendProcess
    Stop-OwnedProcess -Process $backendProcess
}
