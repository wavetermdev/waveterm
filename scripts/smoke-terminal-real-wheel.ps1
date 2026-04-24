param(
    [int]$Port = 0,
    [string]$OutputDir = "D:\files\AI_output\waveterm-terminal-smoke",
    [switch]$KillExistingRepoWave,
    [switch]$KillAllWave,
    [switch]$KeepApp,
    [int]$StartupTimeoutSec = 45
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)
    Write-Host "[smoke-terminal-real-wheel] $Message"
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

function ConvertTo-JsLiteral {
    param([object]$Value)
    return ($Value | ConvertTo-Json -Depth 20 -Compress)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$makeDir = Join-Path $repoRoot "make"
$exePath = Join-Path $makeDir "win-unpacked\Wave.exe"
$startedProcess = $null
$target = $null
$runtime = $null
$screenshot = $null
$cleanupBlockIds = @()

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
$resultPath = Join-Path $OutputDir "terminal-real-wheel-$timestamp.json"
$screenshotPath = Join-Path $OutputDir "terminal-real-wheel-$timestamp.png"

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

    $exeItem = Get-Item -LiteralPath $exePath
    $hash = Get-FileHash -LiteralPath $exePath -Algorithm SHA256

    Write-Step "starting Wave with CDP"
    $startedProcess = Start-Process -FilePath $exePath -ArgumentList "--remote-debugging-port=$Port" -PassThru
    $target = Wait-CdpTarget -CdpPort $Port -TimeoutSec $StartupTimeoutSec
    Write-Step "connected target title='$($target.title)' url='$($target.url)'"

    $runtimeExpression = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot "smoke-terminal.runtime.js")
    $runtime = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $runtimeExpression
    if ($runtime.cleanup) {
        if ($runtime.cleanup.createdBlockIds) {
            $cleanupBlockIds = @($runtime.cleanup.createdBlockIds)
        } elseif ($runtime.cleanup.createdBlockId) {
            $cleanupBlockIds = @($runtime.cleanup.createdBlockId)
        }
    }
    if (!$runtime.hasTerm -or $runtime.scenarioBlockIds.Count -lt 1) {
        throw "terminal runtime did not initialize for real wheel smoke"
    }

    $helperExpression = @"
(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rectToObject = (rect) => rect ? ({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  }) : null;
  const getBlockIdForElement = (elem) => elem?.closest?.('[data-blockid]')?.dataset?.blockid ?? null;
  const describeElement = (elem) => elem ? ({
    tagName: elem.tagName ?? null,
    id: elem.id || null,
    className: typeof elem.className === 'string' ? elem.className : null,
    role: elem.getAttribute?.('role') ?? null,
    blockId: getBlockIdForElement(elem)
  }) : null;
  const refreshRegistry = () => {
    const registry = window.__waveSmokeTermRegistry;
    registry?.refreshFromLiveInstances?.();
    return registry;
  };
  const getWrap = (blockId) => {
    const registry = refreshRegistry();
    if (registry?.byBlockId?.[blockId]) {
      return registry.byBlockId[blockId];
    }
    const liveInstances = window.term?.constructor?.liveInstances;
    if (liveInstances instanceof Set) {
      return Array.from(liveInstances).find((wrap) => wrap?.blockId === blockId) ?? null;
    }
    return null;
  };
  const getRefs = (blockId) => {
    const blockElem = Array.from(document.querySelectorAll('[data-blockid]')).find(
      (elem) => elem.dataset?.blockid === blockId
    );
    const viewElem = blockElem?.querySelector?.('.view-term') ?? null;
    const connectElem = viewElem?.querySelector?.('.term-connectelem') ?? null;
    const xtermElem = connectElem?.querySelector?.('.xterm') ?? null;
    const screenElem =
      connectElem?.querySelector?.('.xterm-screen') ||
      connectElem?.querySelector?.('.xterm-rows') ||
      xtermElem ||
      connectElem ||
      null;
    const scrollableElem = connectElem?.querySelector?.('.xterm-scrollable-element') ?? null;
    const textarea = connectElem?.querySelector?.('.xterm-helper-textarea') ?? null;
    return {
      blockElem,
      viewElem,
      connectElem,
      xtermElem,
      screenElem,
      scrollableElem,
      textarea
    };
  };
  const getPoint = (refs, pointName) => {
    const base = refs.screenElem || refs.xtermElem || refs.connectElem || refs.viewElem;
    const baseRect = base?.getBoundingClientRect?.();
    const viewRect = refs.viewElem?.getBoundingClientRect?.();
    const scrollRect = refs.scrollableElem?.getBoundingClientRect?.();
    const rect = pointName === 'view-right' ? viewRect : pointName === 'scrollbar-center' ? scrollRect : baseRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const safeY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2));
    if (pointName === 'screen-right' || pointName === 'view-right') {
      return { x: rect.right - Math.min(8, Math.max(2, rect.width / 4)), y: safeY, rect: rectToObject(rect) };
    }
    return {
      x: rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2)),
      y: safeY,
      rect: rectToObject(rect)
    };
  };
  const captureAll = () => {
    refreshRegistry();
    const output = {};
    for (const viewElem of Array.from(document.querySelectorAll('.view-term'))) {
      const blockElem = viewElem.closest('[data-blockid]');
      const blockId = blockElem?.dataset?.blockid ?? null;
      if (!blockId) {
        continue;
      }
      const wrap = getWrap(blockId);
      const refs = getRefs(blockId);
      const activeBuffer = wrap?.terminal?.buffer?.active ?? null;
      output[blockId] = {
        viewportY: activeBuffer?.viewportY ?? null,
        baseY: activeBuffer?.baseY ?? null,
        length: activeBuffer?.length ?? null,
        bufferType: activeBuffer?.type ?? null,
        mouseTrackingMode: wrap?.terminal?.modes?.mouseTrackingMode ?? null,
        domScrollTop: refs.scrollableElem?.scrollTop ?? null,
        domScrollHeight: refs.scrollableElem?.scrollHeight ?? null,
        domClientHeight: refs.scrollableElem?.clientHeight ?? null,
        blockFocused: blockElem?.classList?.contains('block-focused') ?? false,
        activeElementInside: !!document.activeElement && !!refs.connectElem?.contains(document.activeElement)
      };
    }
    return output;
  };
  const changedBlocks = (before, after) => Object.keys(after).filter((blockId) => {
    const oldState = before?.[blockId] ?? {};
    const newState = after?.[blockId] ?? {};
    return oldState.viewportY !== newState.viewportY || oldState.domScrollTop !== newState.domScrollTop;
  });
  window.__waveRealWheel = {
    liveIntervalId: null,
    startLiveOutput(blockId) {
      const wrap = getWrap(blockId);
      if (!wrap?.terminal) {
        return { started: false, reason: 'missing_wrap' };
      }
      if (this.liveIntervalId) {
        clearInterval(this.liveIntervalId);
      }
      let writeCount = 0;
      this.liveIntervalId = setInterval(() => {
        writeCount += 1;
        wrap.terminal.write('real-live-' + writeCount + '-' + 'x'.repeat(72) + '\r\n');
      }, 80);
      return { started: true, blockId };
    },
    stopLiveOutput() {
      if (this.liveIntervalId) {
        clearInterval(this.liveIntervalId);
        this.liveIntervalId = null;
      }
      return { stopped: true };
    },
    async prepare(blockId, pointName) {
      const wrap = getWrap(blockId);
      const refs = getRefs(blockId);
      if (!wrap?.terminal || !refs.connectElem) {
        return { blockId, pointName, error: 'missing terminal wrap or connect element' };
      }
      const seed = Array.from({ length: 220 }, (_, idx) => 'real-wheel-' + pointName + '-' + idx).join('\r\n') + '\r\n';
      await new Promise((resolve) => wrap.terminal.write(seed, resolve));
      wrap.terminal.scrollToBottom?.();
      refs.textarea?.focus?.({ preventScroll: true });
      wrap.terminal.focus?.();
      await wait(160);
      const point = getPoint(refs, pointName);
      const hit = point ? document.elementFromPoint(point.x, point.y) : null;
      const before = captureAll();
      return {
        blockId,
        pointName,
        point,
        hit: describeElement(hit),
        focused: describeElement(document.activeElement),
        targetBefore: before[blockId] ?? null,
        before,
        refs: {
          view: rectToObject(refs.viewElem?.getBoundingClientRect?.()),
          connect: rectToObject(refs.connectElem?.getBoundingClientRect?.()),
          screen: rectToObject(refs.screenElem?.getBoundingClientRect?.()),
          scrollable: rectToObject(refs.scrollableElem?.getBoundingClientRect?.())
        }
      };
    },
    captureAll,
    changedBlocks
  };
})()
"@
    Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $helperExpression | Out-Null

    $scenarioResults = @()
    $liveScenarioResults = @()
    $pointNames = @("screen-center", "screen-right")
    foreach ($blockId in @($runtime.scenarioBlockIds | Select-Object -First 2)) {
        foreach ($pointName in $pointNames) {
            $beforeExpression = @"
(async () => {
  const result = await window.__waveRealWheel.prepare($(ConvertTo-JsLiteral $blockId), $(ConvertTo-JsLiteral $pointName));
  window.__waveRealWheelLastBefore = result.before;
  return {
    blockId: result.blockId,
    pointName: result.pointName,
    point: result.point,
    hit: result.hit,
    focused: result.focused,
    targetBefore: result.targetBefore,
    refs: result.refs,
    error: result.error ?? null
  };
})()
"@
            $before = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $beforeExpression
            if (!$before -or !$before.point -or $null -eq $before.point.x -or $null -eq $before.point.y) {
                $scenarioResults += [ordered]@{
                    blockId = $blockId
                    pointName = $pointName
                    pass = $false
                    diagnosis = "missing_point"
                    before = $before
                    after = $null
                }
                Write-Step "block=$blockId point=$pointName diagnosis=missing_point"
                continue
            }

            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Page.bringToFront" | Out-Null
            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Input.dispatchMouseEvent" -Params @{
                type = "mouseMoved"
                x = [double]$before.point.x
                y = [double]$before.point.y
            } | Out-Null
            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Input.dispatchMouseEvent" -Params @{
                type = "mouseWheel"
                x = [double]$before.point.x
                y = [double]$before.point.y
                deltaX = 0
                deltaY = -720
            } | Out-Null

            $afterExpression = @"
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 320));
  const after = window.__waveRealWheel.captureAll();
  const before = window.__waveRealWheelLastBefore || {};
  const changedBlocks = window.__waveRealWheel.changedBlocks(before, after);
  const targetChanged = changedBlocks.includes($(ConvertTo-JsLiteral $blockId));
  const wrongChanged = changedBlocks.filter((id) => id !== $(ConvertTo-JsLiteral $blockId));
  let diagnosis = 'ok';
  if (!targetChanged) {
    diagnosis = 'real_wheel_no_scroll';
  } else if (wrongChanged.length > 0) {
    diagnosis = 'real_wheel_wrong_terminal';
  }
  return {
    changedBlocks,
    wrongChanged,
    targetAfter: after[$(ConvertTo-JsLiteral $blockId)] ?? null,
    pass: diagnosis === 'ok',
    diagnosis
  };
})()
"@
            $after = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $afterExpression
            $scenarioResults += [ordered]@{
                blockId = $blockId
                pointName = $pointName
                deltaY = -720
                before = $before
                after = $after
                pass = [bool]$after.pass
                diagnosis = $after.diagnosis
            }
            Write-Step "block=$blockId point=$pointName diagnosis=$($after.diagnosis)"
        }
    }

    if ($runtime.diagnostic -and $runtime.diagnostic.target -and $runtime.diagnostic.target.blockId) {
        $liveBlockId = [string]$runtime.diagnostic.target.blockId
        $livePointNames = @("screen-center", "screen-right", "view-right", "scrollbar-center")
        Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression "(() => window.__waveRealWheel.startLiveOutput($(ConvertTo-JsLiteral $liveBlockId)))()" | Out-Null
        Start-Sleep -Milliseconds 220
        foreach ($pointName in $livePointNames) {
            $beforeExpression = @"
(async () => {
  const result = await window.__waveRealWheel.prepare($(ConvertTo-JsLiteral $liveBlockId), $(ConvertTo-JsLiteral $pointName));
  window.__waveRealWheelLastBefore = result.before;
  return {
    blockId: result.blockId,
    pointName: result.pointName,
    point: result.point,
    hit: result.hit,
    focused: result.focused,
    targetBefore: result.targetBefore,
    refs: result.refs,
    error: result.error ?? null
  };
})()
"@
            $before = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $beforeExpression
            if (!$before -or !$before.point -or $null -eq $before.point.x -or $null -eq $before.point.y) {
                $liveScenarioResults += [ordered]@{
                    blockId = $liveBlockId
                    pointName = $pointName
                    pass = $false
                    diagnosis = "live_missing_point"
                    before = $before
                    after = $null
                }
                Write-Step "live block=$liveBlockId point=$pointName diagnosis=live_missing_point"
                continue
            }

            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Page.bringToFront" | Out-Null
            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Input.dispatchMouseEvent" -Params @{
                type = "mouseMoved"
                x = [double]$before.point.x
                y = [double]$before.point.y
            } | Out-Null
            Invoke-CdpCommand -WebSocketUrl $target.webSocketDebuggerUrl -Method "Input.dispatchMouseEvent" -Params @{
                type = "mouseWheel"
                x = [double]$before.point.x
                y = [double]$before.point.y
                deltaX = 0
                deltaY = -720
            } | Out-Null

            $afterExpression = @"
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 320));
  const after = window.__waveRealWheel.captureAll();
  const before = window.__waveRealWheelLastBefore || {};
  const changedBlocks = window.__waveRealWheel.changedBlocks(before, after);
  const wrongChanged = changedBlocks.filter((id) => id !== $(ConvertTo-JsLiteral $liveBlockId));
  const targetBefore = before[$(ConvertTo-JsLiteral $liveBlockId)] ?? {};
  const targetAfter = after[$(ConvertTo-JsLiteral $liveBlockId)] ?? {};
  const beforeDistance =
    targetBefore.baseY != null && targetBefore.viewportY != null
      ? targetBefore.baseY - targetBefore.viewportY
      : null;
  const afterDistance =
    targetAfter.baseY != null && targetAfter.viewportY != null
      ? targetAfter.baseY - targetAfter.viewportY
      : null;
  let diagnosis = 'ok';
  if (afterDistance == null || beforeDistance == null) {
    diagnosis = 'live_real_missing_distance';
  } else if (afterDistance <= beforeDistance) {
    diagnosis = 'live_real_no_scroll';
  } else if (wrongChanged.length > 0) {
    diagnosis = 'live_real_wrong_terminal';
  }
  return {
    changedBlocks,
    wrongChanged,
    targetAfter,
    beforeDistance,
    afterDistance,
    pass: diagnosis === 'ok',
    diagnosis
  };
})()
"@
            $after = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $afterExpression
            $liveScenarioResults += [ordered]@{
                blockId = $liveBlockId
                pointName = $pointName
                deltaY = -720
                before = $before
                after = $after
                pass = [bool]$after.pass
                diagnosis = $after.diagnosis
            }
            Write-Step "live block=$liveBlockId point=$pointName diagnosis=$($after.diagnosis)"
        }
        Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression "(() => window.__waveRealWheel.stopLiveOutput())()" | Out-Null
    }

    $cleanupResult = $null
    if ($cleanupBlockIds.Count -gt 0) {
        $cleanupBlockIdsLiteral = ConvertTo-JsLiteral $cleanupBlockIds
        $cleanupExpression = @"
(async () => {
  const blockIds = $cleanupBlockIdsLiteral;
  if (!Array.isArray(blockIds) || blockIds.length === 0 || !window.RpcApi || !window.TabRpcClient) {
    return { cleaned: false, blockIds, reason: 'missing blockIds, RpcApi or TabRpcClient' };
  }
  const results = [];
  for (const blockId of blockIds.slice().reverse()) {
    try {
      await window.RpcApi.DeleteBlockCommand(window.TabRpcClient, { blockid: blockId });
      results.push({ blockId, cleaned: true });
    } catch (error) {
      results.push({ blockId, cleaned: false, error: error?.message ?? String(error) });
    }
  }
  return { cleaned: results.every((item) => item.cleaned), blockIds, results };
})()
"@
        $cleanupResult = Invoke-CdpEvaluate -WebSocketUrl $target.webSocketDebuggerUrl -Expression $cleanupExpression
    }

    $screenshot = Save-CdpScreenshot -WebSocketUrl $target.webSocketDebuggerUrl -Path $screenshotPath
    $blockPass = @{}
    foreach ($scenario in $scenarioResults) {
        if (!$blockPass.ContainsKey($scenario.blockId)) {
            $blockPass[$scenario.blockId] = $false
        }
        if ($scenario.pass) {
            $blockPass[$scenario.blockId] = $true
        }
    }
    $allPassed = $blockPass.Count -gt 0 -and !($blockPass.Values -contains $false)
    $summary = [ordered]@{
        status = if ($allPassed) { "passing" } else { "failing" }
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
        runtime = $runtime
        realWheel = [ordered]@{
            scenarios = $scenarioResults
            allPassed = $allPassed
            diagnoses = @($scenarioResults | ForEach-Object { $_.diagnosis } | Select-Object -Unique)
        }
        liveRealWheel = [ordered]@{
            targetBlockId = if ($runtime.diagnostic -and $runtime.diagnostic.target) { $runtime.diagnostic.target.blockId } else { $null }
            scenarios = $liveScenarioResults
            allPassed = @($liveScenarioResults | Where-Object { -not $_.pass }).Count -eq 0
            diagnoses = @($liveScenarioResults | ForEach-Object { $_.diagnosis } | Select-Object -Unique)
        }
        cleanup = $cleanupResult
        screenshot = $screenshot
    }
    $summary | ConvertTo-Json -Depth 100 | Set-Content -Path $resultPath -Encoding UTF8

    if (!$allPassed) {
        Write-Step "FAIL: real wheel did not scroll any tested point"
        Write-Step "result: $resultPath"
        throw "real wheel smoke failed: $(@($scenarioResults | ForEach-Object { $_.diagnosis } | Select-Object -Unique) -join ', ')"
    }

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
        cdp = if ($target) {
            [ordered]@{
                port = $Port
                targetTitle = $target.title
                targetUrl = $target.url
            }
        } else {
            [ordered]@{
                port = $Port
            }
        }
        runtime = $runtime
        screenshot = $screenshot
        error = $_.Exception.Message
    }
    $failure | ConvertTo-Json -Depth 100 | Set-Content -Path $resultPath -Encoding UTF8
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
