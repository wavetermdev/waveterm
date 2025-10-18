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
    # Check if we're in tmux or screen (using fish-native checks)
    set -q TMUX; or set -q STY; or string match -q 'tmux*' -- $TERM; or string match -q 'screen*' -- $TERM
end

function _waveterm_si_osc7
    _waveterm_si_blocked; and return
    # Use fish-native URL encoding
    set -l encoded_pwd (string escape --style=url -- $PWD)
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