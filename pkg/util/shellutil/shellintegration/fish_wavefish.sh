# this file is sourced with -C
# Add Wave binary directory to PATH
set -x PATH {{.WSHBINDIR}} $PATH

# Source dynamic script from wsh token (the echo is to prevent fish from complaining about empty input)
wsh token "$WAVETERM_SWAPTOKEN" fish 2>/dev/null | source
set -e WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion fish | source

set -g _WAVETERM_SI_FIRSTPROMPT 1

# shell integration
function _waveterm_si_blocked
    # Check if we're in tmux or screen (using fish-native checks)
    set -q TMUX; or set -q STY; or string match -q 'tmux*' -- $TERM; or string match -q 'screen*' -- $TERM
end

function _waveterm_si_osc7
    _waveterm_si_blocked; and return
    # Use fish-native URL encoding
    set -l encoded_pwd (string escape --style=url -- "$PWD")
    printf '\033]7;file://localhost%s\007' $encoded_pwd
end

function _waveterm_si_prompt --on-event fish_prompt
    set -l _waveterm_si_status $status
    _waveterm_si_blocked; and return
    if test $_WAVETERM_SI_FIRSTPROMPT -eq 1
        set -l uname_info (uname -smr 2>/dev/null)
        printf '\033]16162;M;{"shell":"fish","shellversion":"%s","uname":"%s","integration":true}\007' $FISH_VERSION "$uname_info"
        # OSC 7 only sent on first prompt - chpwd hook handles directory changes
        _waveterm_si_osc7
    else
        printf '\033]16162;D;{"exitcode":%d}\007' $_waveterm_si_status
    end
    printf '\033]16162;A\007'
    set -g _WAVETERM_SI_FIRSTPROMPT 0
end

function _waveterm_si_preexec --on-event fish_preexec
    _waveterm_si_blocked; and return
    set -l cmd (string join -- ' ' $argv)
    set -l cmd_length (string length -- "$cmd")
    if test $cmd_length -gt 8192
        set -l cmd64 (printf '# command too large (%d bytes)' $cmd_length | base64 2>/dev/null | string replace -a '\n' '' | string replace -a '\r' '')
        printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64"
    else
        set -l cmd64 (printf '%s' "$cmd" | base64 2>/dev/null | string replace -a '\n' '' | string replace -a '\r' '')
        if test -n "$cmd64"
            printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64"
        else
            printf '\033]16162;C\007'
        end
    end
end

# Also update on directory change
function _waveterm_si_chpwd --on-variable PWD
    _waveterm_si_osc7
end