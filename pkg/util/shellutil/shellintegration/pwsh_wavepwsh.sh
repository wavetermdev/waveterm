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

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_urlencode {
    param([string]$str)
    # URL encode the path
    # Escape % first
    $str = $str -replace '%', '%25'
    # Common reserved characters in file paths
    $str = $str -replace ' ', '%20'
    $str = $str -replace '#', '%23'
    $str = $str -replace '\?', '%3F'
    $str = $str -replace '&', '%26'
    $str = $str -replace ';', '%3B'
    $str = $str -replace '\+', '%2B'
    return $str
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }
    
    $pwd_str = $PWD.Path
    
    # Convert Windows path to file:// URL format
    # Replace backslashes with forward slashes
    $pwd_str = $pwd_str -replace '\\', '/'
    
    # Ensure it starts with / for proper file:// URL format
    # Windows paths like C:/... need to become /C:/...
    if ($pwd_str -match '^[a-zA-Z]:') {
        $pwd_str = '/' + $pwd_str
    }
    
    $encoded_pwd = _waveterm_si_urlencode $pwd_str
    $hostname = $env:COMPUTERNAME
    if (-not $hostname) {
        $hostname = hostname
    }
    
    # OSC 7 - current directory
    Write-Host -NoNewline "`e]7;file://$hostname$encoded_pwd`a"
}

# Hook OSC 7 to prompt
function Global:_waveterm_si_prompt {
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