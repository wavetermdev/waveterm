# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source user's PowerShell profile if it exists
# Wave uses -NoProfile for clean startup, so we load the profile here
if (Test-Path $PROFILE) {
    . $PROFILE
}

# Source dynamic script from wsh token
$waveterm_swaptoken_output = wsh token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

if ($PSVersionTable.PSVersion.Major -lt 7) {
    return  # skip OSC setup entirely - PSReadLine hooks require PS7+
}

$Global:_WAVETERM_SI_FIRSTPROMPT = $true
$Global:_WAVETERM_SI_LASTEXITCODE = 0
$Global:_WAVETERM_SI_COMMAND_STARTED = $false

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }

    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)

    # OSC 7 - current directory
    Write-Host -NoNewline "`e]7;file://localhost/$encoded_pwd`a"
}

# OSC 16162 commands for full shell integration
# A = ready (at prompt)
# C = command started (with base64 encoded command)
# D = command done (with exit code)

function Global:_waveterm_si_send_ready {
    if (_waveterm_si_blocked) { return }
    Write-Host -NoNewline "`e]16162;A`a"
}

function Global:_waveterm_si_send_command {
    param([string]$Command)
    if (_waveterm_si_blocked) { return }
    if ([string]::IsNullOrWhiteSpace($Command)) { return }

    # Base64 encode the command
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Command)
    $cmd64 = [System.Convert]::ToBase64String($bytes)

    # Limit command length to avoid issues
    if ($cmd64.Length -gt 8192) {
        Write-Host -NoNewline "`e]16162;C`a"
    } else {
        Write-Host -NoNewline "`e]16162;C;{`"cmd64`":`"$cmd64`"}`a"
    }
    $Global:_WAVETERM_SI_COMMAND_STARTED = $true
}

function Global:_waveterm_si_send_done {
    param([int]$ExitCode)
    if (_waveterm_si_blocked) { return }
    if (-not $Global:_WAVETERM_SI_COMMAND_STARTED) { return }

    Write-Host -NoNewline "`e]16162;D;{`"exitcode`":$ExitCode}`a"
    $Global:_WAVETERM_SI_COMMAND_STARTED = $false
}

function Global:_waveterm_si_prompt {
    if (_waveterm_si_blocked) { return }

    # Capture exit code immediately (before any other commands change it)
    $currentExitCode = if ($?) { 0 } else { if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 } }

    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
        # Send metadata on first prompt
        $shellversion = $PSVersionTable.PSVersion.ToString()
        Write-Host -NoNewline "`e]16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":true}`a"
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
    } else {
        # Send command done for previous command (if any)
        _waveterm_si_send_done -ExitCode $currentExitCode
    }

    # Send OSC 7 for current directory
    _waveterm_si_osc7

    # Send ready signal
    _waveterm_si_send_ready
}

# Hook into PSReadLine to detect when commands are executed
# This is called just before a command is accepted and executed
if (Get-Module PSReadLine) {
    # Save any existing AcceptLine handler
    $existingHandler = (Get-PSReadLineKeyHandler -Chord Enter | Where-Object { $_.Function -eq 'AcceptLine' })

    # Create a wrapper that sends command notification before executing
    Set-PSReadLineKeyHandler -Chord Enter -ScriptBlock {
        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        # Send command started notification
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            _waveterm_si_send_command -Command $line
        }

        # Call the original AcceptLine function
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
}

# Add the prompt hooks
if (Test-Path Function:\prompt) {
    $global:_waveterm_original_prompt = $function:prompt
    function Global:prompt {
        _waveterm_si_prompt
        & $global:_waveterm_original_prompt
    }
} else {
    function Global:prompt {
        _waveterm_si_prompt
        "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
}
