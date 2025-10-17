# this file is sourced with -C
# Add Wave binary directory to PATH
set -x PATH {{.WSHBINDIR}} $PATH

# Source dynamic script from wsh token (the echo is to prevent fish from complaining about empty input)
wsh token "$WAVETERM_SWAPTOKEN" fish 2>/dev/null | source
set -e WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion fish | source

# shell integration
function _waveterm_si_blocked
    # Check if we're in tmux or screen
    test -n "$TMUX" -o -n "$STY" -o "$TERM" = "tmux" -o "$TERM" = "screen"
end

function _waveterm_si_urlencode
    set -l str $argv[1]
    # URL encode the path
    # Escape % first
    set str (string replace -a '%' '%25' -- $str)
    # Common reserved characters in file paths
    set str (string replace -a ' ' '%20' -- $str)
    set str (string replace -a '#' '%23' -- $str)
    set str (string replace -a '?' '%3F' -- $str)
    set str (string replace -a '&' '%26' -- $str)
    set str (string replace -a ';' '%3B' -- $str)
    set str (string replace -a '+' '%2B' -- $str)
    echo -n $str
end

function _waveterm_si_osc7
    _waveterm_si_blocked; and return
    set -l encoded_pwd (_waveterm_si_urlencode $PWD)
    printf '\033]7;file://%s%s\007' $hostname $encoded_pwd
end

# Hook OSC 7 to prompt and directory changes
function _waveterm_si_prompt --on-event fish_prompt
    _waveterm_si_osc7
end

# Also update on directory change
function _waveterm_si_chpwd --on-variable PWD
    _waveterm_si_osc7
end