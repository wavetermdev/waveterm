param(
    [int]$Port = 0,
    [string]$OutputDir = "D:\files\AI_output\waveterm-terminal-smoke",
    [switch]$KillExistingRepoWave,
    [switch]$KillAllWave,
    [switch]$KeepApp,
    [bool]$RequireTerminal = $true,
    [int]$StartupTimeoutSec = 45
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)
    Write-Host "[smoke-terminal] $Message"
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return [int]$listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}

function Stop-WaveProcesses {
    param(
        [string]$RepoMakeDir,
        [switch]$AllWave
    )

    $processes = Get-Process Wave -ErrorAction SilentlyContinue
    if ($null -eq $processes) {
        return
    }

    foreach ($process in $processes) {
        $path = $null
        try {
            $path = $process.Path
        } catch {
            $path = $null
        }

        $shouldStop = $AllWave
        if (!$shouldStop -and $path) {
            $shouldStop = $path.StartsWith($RepoMakeDir, [System.StringComparison]::OrdinalIgnoreCase)
        }
        if (!$shouldStop) {
            continue
        }

        Write-Step "stopping Wave process pid=$($process.Id) path=$path"
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}

function Wait-CdpTarget {
    param(
        [int]$CdpPort,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/list" -TimeoutSec 2
            if ($targets) {
                $target = $targets |
                    Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } |
                    Sort-Object @{ Expression = { if ($_.url -like "file:*" -or $_.url -like "app:*") { 0 } else { 1 } } } |
                    Select-Object -First 1
                if ($target) {
                    return $target
                }
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    throw "CDP target not available on port $CdpPort within ${TimeoutSec}s. Last error: $lastError"
}

function Receive-CdpMessage {
    param([System.Net.WebSockets.ClientWebSocket]$WebSocket)

    $buffer = New-Object byte[] 65536
    $stream = [System.IO.MemoryStream]::new()
    try {
        do {
            $segment = [System.ArraySegment[byte]]::new($buffer)
            $result = $WebSocket.ReceiveAsync($segment, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                throw "CDP websocket closed before command response"
            }
            if ($result.Count -gt 0) {
                $stream.Write($buffer, 0, $result.Count)
            }
        } while (!$result.EndOfMessage)

        $text = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
        return $text | ConvertFrom-Json
    } finally {
        $stream.Dispose()
    }
}

function Invoke-CdpCommand {
    param(
        [string]$WebSocketUrl,
        [string]$Method,
        [hashtable]$Params = @{}
    )

    $webSocket = [System.Net.WebSockets.ClientWebSocket]::new()
    try {
        $webSocket.ConnectAsync([Uri]$WebSocketUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $commandId = Get-Random -Minimum 1000 -Maximum 999999
        $payload = @{
            id = $commandId
            method = $Method
            params = $Params
        } | ConvertTo-Json -Depth 100 -Compress

        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $segment = [System.ArraySegment[byte]]::new($bytes)
        $webSocket.SendAsync(
            $segment,
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [System.Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        while ($true) {
            $message = Receive-CdpMessage -WebSocket $webSocket
            if ($message.id -eq $commandId) {
                if ($message.error) {
                    throw "CDP command $Method failed: $($message.error.message)"
                }
                return $message
            }
        }
    } finally {
        if ($webSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $webSocket.CloseAsync(
                [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                "done",
                [System.Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
        }
        $webSocket.Dispose()
    }
}

function Invoke-CdpEvaluate {
    param(
        [string]$WebSocketUrl,
        [string]$Expression
    )

    $response = Invoke-CdpCommand -WebSocketUrl $WebSocketUrl -Method "Runtime.evaluate" -Params @{
        expression = $Expression
        awaitPromise = $true
        returnByValue = $true
    }
    if ($response.result.exceptionDetails) {
        $description = $response.result.exceptionDetails.exception.description
        if (!$description) {
            $description = $response.result.exceptionDetails.text
        }
        throw "Runtime.evaluate failed: $description"
    }
    return $response.result.result.value
}

function Save-CdpScreenshot {
    param(
        [string]$WebSocketUrl,
        [string]$Path
    )

    try {
        $response = Invoke-CdpCommand -WebSocketUrl $WebSocketUrl -Method "Page.captureScreenshot" -Params @{
            format = "png"
            fromSurface = $true
        }
        if ($response.result.data) {
            [System.IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String($response.result.data))
            return $Path
        }
    } catch {
        Write-Step "screenshot skipped: $($_.Exception.Message)"
    }
    return $null
}

function Assert-NoTerminalHistoryRestoreCode {
    param([string]$TermwrapPath)

    $patterns = @(
        "cache:term:full",
        "SaveTerminalState",
        "loadInitialTerminalData",
        "runProcessIdleTimeout",
        "processAndCacheData",
        "SerializeAddon",
        "fetchWaveFile"
    )
    $matches = Select-String -LiteralPath $TermwrapPath -Pattern $patterns -SimpleMatch -ErrorAction Stop
    if ($matches) {
        $formatted = $matches | ForEach-Object { "$($_.Path):$($_.LineNumber):$($_.Line.Trim())" }
        throw "terminal history restore/cache code is still present:`n$($formatted -join "`n")"
    }
    return @{
        checked = $true
        bannedPatterns = $patterns
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$makeDir = Join-Path $repoRoot "make"
$exePath = Join-Path $makeDir "win-unpacked\Wave.exe"
$termwrapPath = Join-Path $repoRoot "frontend\app\view\term\termwrap.ts"
$startedProcess = $null

if (!(Test-Path -LiteralPath $exePath)) {
    throw "Wave executable not found: $exePath. Run electron-builder --win dir first."
}

if (!(Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

if ($Port -le 0) {
    $Port = Get-FreeTcpPort
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resultPath = Join-Path $OutputDir "terminal-smoke-$timestamp.json"
$screenshotPath = Join-Path $OutputDir "terminal-smoke-$timestamp.png"

Write-Step "repo root: $repoRoot"
Write-Step "exe: $exePath"
Write-Step "output: $resultPath"
Write-Step "cdp port: $Port"

try {
    if ($KillAllWave) {
        Stop-WaveProcesses -RepoMakeDir $makeDir -AllWave
    } elseif ($KillExistingRepoWave) {
        Stop-WaveProcesses -RepoMakeDir $makeDir
    }

    $staticCheck = Assert-NoTerminalHistoryRestoreCode -TermwrapPath $termwrapPath
    $exeItem = Get-Item -LiteralPath $exePath
    $hash = Get-FileHash -LiteralPath $exePath -Algorithm SHA256

    Write-Step "starting Wave with CDP"
    $startedProcess = Start-Process -FilePath $exePath -ArgumentList "--remote-debugging-port=$Port" -PassThru
    $target = Wait-CdpTarget -CdpPort $Port -TimeoutSec $StartupTimeoutSec
    Write-Step "connected target title='$($target.title)' url='$($target.url)'"

    $runtimeExpression = @'
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now();
  while (!window.term && Date.now() - started < 15000) {
    await wait(250);
  }
  const summary = {
    href: location.href,
    title: document.title,
    hasTerm: !!window.term,
    waitedMs: Date.now() - started
  };
  if (!window.term) {
    return summary;
  }

  const termWrap = window.term;
  const terminal = termWrap.terminal;
  const activeBuffer = terminal.buffer.active;
  const historyMethodsPresent = [
    'loadInitialTerminalData',
    'processAndCacheData',
    'runProcessIdleTimeout',
    'persistTerminalState'
  ].filter((name) => typeof termWrap[name] === 'function');

  summary.term = {
    loaded: termWrap.loaded,
    rows: terminal.rows,
    cols: terminal.cols,
    bufferType: activeBuffer.type,
    cursorX: activeBuffer.cursorX,
    cursorY: activeBuffer.cursorY,
    viewportY: activeBuffer.viewportY,
    baseY: activeBuffer.baseY,
    length: activeBuffer.length,
    historyMethodsPresent,
    hasSerializeAddon: Object.prototype.hasOwnProperty.call(termWrap, 'serializeAddon'),
    hasPtyOffset: Object.prototype.hasOwnProperty.call(termWrap, 'ptyOffset'),
    heldDataLength: Array.isArray(termWrap.heldData) ? termWrap.heldData.length : null
  };

  const output = Array.from({ length: 180 }, (_, idx) => `smoke-scroll-${idx}`).join('\r\n') + '\r\n';
  await new Promise((resolve) => terminal.write(output, resolve));
  terminal.scrollToBottom();
  await wait(80);

  const beforeViewportY = terminal.buffer.active.viewportY;
  const scrollTarget =
    terminal._core?._viewport?._scrollableElement?._domNode ||
    document.querySelector('.xterm-scrollable-element') ||
    document.querySelector('.xterm-screen') ||
    terminal.element;
  const wheelEvent = new WheelEvent('wheel', {
    deltaY: -720,
    deltaMode: 0,
    bubbles: true,
    cancelable: true
  });
  scrollTarget?.dispatchEvent(wheelEvent);
  await wait(120);
  const afterViewportY = terminal.buffer.active.viewportY;
  summary.wheel = {
    targetClass: scrollTarget?.className || null,
    beforeViewportY,
    afterViewportY,
    changed: beforeViewportY !== afterViewportY,
    defaultPrevented: wheelEvent.defaultPrevented
  };

  const originalShouldAnchor = termWrap.shouldAnchorImeForAgentTui;
  let forcedImeSync = false;
  try {
    if (typeof termWrap.syncImePositionForAgentTui === 'function') {
      termWrap.shouldAnchorImeForAgentTui = () => true;
      termWrap.syncImePositionForAgentTui();
      forcedImeSync = true;
      await wait(80);
    }
  } finally {
    termWrap.shouldAnchorImeForAgentTui = originalShouldAnchor;
  }

  const textarea = terminal.textarea;
  const compositionView = document.querySelector('.composition-view.active');
  const cell = terminal._core?._renderService?.dimensions?.css?.cell || {};
  const cellHeight = cell.height || 16;
  const cellWidth = cell.width || 8;
  const cursorX = terminal.buffer.active.cursorX || 0;
  const cursorY = terminal.buffer.active.cursorY || 0;
  const expectedTop = cursorY * cellHeight;
  const expectedLeft = cursorX * cellWidth;
  const actualTop = Number.parseFloat(textarea?.style?.top || 'NaN');
  const actualLeft = Number.parseFloat(textarea?.style?.left || 'NaN');
  const topDelta = Number.isFinite(actualTop) ? Math.abs(actualTop - expectedTop) : null;
  const leftDelta = Number.isFinite(actualLeft) ? Math.abs(actualLeft - expectedLeft) : null;

  summary.ime = {
    forcedImeSync,
    cursorX,
    cursorY,
    cellHeight,
    cellWidth,
    expectedTop,
    expectedLeft,
    textareaTop: textarea?.style?.top || null,
    textareaLeft: textarea?.style?.left || null,
    compositionTop: compositionView?.style?.top || null,
    compositionLeft: compositionView?.style?.left || null,
    topDelta,
    leftDelta,
    aligned: topDelta !== null && leftDelta !== null && topDelta <= 1 && leftDelta <= 1
  };

  return summary;
})()
'@

    $runtime = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $runtimeExpression
    $screenshot = Save-CdpScreenshot -WebSocketUrl $target.webSocketDebuggerUrl -Path $screenshotPath

    if ($RequireTerminal -and !$runtime.hasTerm) {
        throw "window.term not found. Open a terminal block first, or rerun with -RequireTerminal:`$false."
    }
    if ($runtime.hasTerm) {
        if ($runtime.term.historyMethodsPresent.Count -gt 0) {
            throw "runtime still exposes terminal history methods: $($runtime.term.historyMethodsPresent -join ', ')"
        }
        if ($runtime.term.hasSerializeAddon) {
            throw "runtime still exposes serializeAddon"
        }
        if (!$runtime.wheel.changed) {
            throw "wheel smoke did not change viewportY"
        }
        if (!$runtime.ime.aligned) {
            throw "IME textarea is not aligned with cursor"
        }
    }

    $summary = [ordered]@{
        status = "passing"
        timestamp = (Get-Date).ToString("o")
        repoRoot = $repoRoot
        executable = [ordered]@{
            path = $exeItem.FullName
            lastWriteTime = $exeItem.LastWriteTime.ToString("o")
            length = $exeItem.Length
            sha256 = $hash.Hash
        }
        cdp = [ordered]@{
            port = $Port
            targetTitle = $target.title
            targetUrl = $target.url
        }
        staticCheck = $staticCheck
        runtime = $runtime
        screenshot = $screenshot
    }

    $summary | ConvertTo-Json -Depth 100 | Set-Content -Path $resultPath -Encoding UTF8
    Write-Step "PASS"
    Write-Step "result: $resultPath"
    if ($screenshot) {
        Write-Step "screenshot: $screenshot"
    }
} catch {
    $failure = [ordered]@{
        status = "failing"
        timestamp = (Get-Date).ToString("o")
        repoRoot = $repoRoot
        executable = $exePath
        cdpPort = $Port
        error = $_.Exception.Message
    }
    $failure | ConvertTo-Json -Depth 20 | Set-Content -Path $resultPath -Encoding UTF8
    Write-Step "FAIL: $($_.Exception.Message)"
    Write-Step "result: $resultPath"
    throw
} finally {
    if (!$KeepApp) {
        $running = Get-Process Wave -ErrorAction SilentlyContinue | Where-Object {
            try {
                $_.Path -and $_.Path.Equals($exePath, [System.StringComparison]::OrdinalIgnoreCase)
            } catch {
                $false
            }
        }
        foreach ($process in $running) {
            Write-Step "cleanup Wave process pid=$($process.Id)"
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    } elseif ($startedProcess) {
        Write-Step "keeping Wave process pid=$($startedProcess.Id)"
    }
}
