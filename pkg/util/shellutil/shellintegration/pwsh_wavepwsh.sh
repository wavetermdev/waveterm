# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from wsh token
$waveterm_swaptoken_output = wsh token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

$Global:_WAVETERM_SI_FIRSTPROMPT = $true

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }
    
    # Get hostname (allow empty for file:/// format)
    $hostname = $env:COMPUTERNAME
    if (-not $hostname) {
        $hostname = $env:HOSTNAME
    }
    
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)
    
    # OSC 7 - current directory
    Write-Host -NoNewline "`e]7;file://$hostname/$encoded_pwd`a"
}

function Global:_waveterm_si_prompt {
    if (_waveterm_si_blocked) { return }
    
    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
		# not sending uname
		       $shellversion = $PSVersionTable.PSVersion.ToString()
		       Write-Host -NoNewline "`e]16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":false}`a"
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
    }
    
    _waveterm_si_osc7
}

# Add the OSC 7 call to the prompt function
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