# add wsh to path, source dynamic script from wsh token
WAVETERM_WSHBINDIR={{.WSHBINDIR}}
export PATH="$WAVETERM_WSHBINDIR:$PATH"
source <(wsh token "$WAVETERM_SWAPTOKEN" zsh 2>/dev/null)
unset WAVETERM_SWAPTOKEN

# Source the original zshrc only if ZDOTDIR has not been changed
if [ "$ZDOTDIR" = "$WAVETERM_ZDOTDIR" ]; then
  [ -f ~/.zshrc ] && source ~/.zshrc
fi

if [[ ":$PATH:" != *":$WAVETERM_WSHBINDIR:"* ]]; then
  export PATH="$WAVETERM_WSHBINDIR:$PATH"
fi
unset WAVETERM_WSHBINDIR

if [[ -n ${_comps+x} ]]; then
  source <(wsh completion zsh)
fi

typeset -g _WAVETERM_SI_FIRSTPRECMD=1

# shell integration
_waveterm_si_blocked() {
  [[ -n "$TMUX" || -n "$STY" || "$TERM" == tmux* || "$TERM" == screen* ]]
}

_waveterm_si_urlencode() {
  if (( $+functions[omz_urlencode] )); then
    omz_urlencode "$1"
  else
    local s="$1"
    # Escape % first
    s=${s//\%/%25}
    # Common reserved characters in file paths
    s=${s//\ /%20}
    s=${s//\#/%23}
    s=${s//\?/%3F}
    s=${s//\&/%26}
    s=${s//\;/%3B}
    s=${s//\+/%2B}
    printf '%s' "$s"
  fi
}

_waveterm_si_osc7() {
  _waveterm_si_blocked && return
  local encoded_pwd=$(_waveterm_si_urlencode "$PWD")
  printf '\033]7;file://%s%s\007' "$HOST" "$encoded_pwd"  # OSC 7 - current directory
}

_waveterm_si_precmd() {
  local _waveterm_si_status=$?
  _waveterm_si_blocked && return
  # D;status for previous command (skip before first prompt)
  if (( !_WAVETERM_SI_FIRSTPRECMD )); then
    printf '\033]16162;D;{"exitcode":%d}\007' $_waveterm_si_status
  else
    local uname_info=$(uname -smr 2>/dev/null)
    printf '\033]16162;M;{"shell":"zsh","shellversion":"%s","uname":"%s","integration":true}\007' "$ZSH_VERSION" "$uname_info"
    # OSC 7 only sent on first prompt - chpwd hook handles directory changes
    _waveterm_si_osc7
  fi
  printf '\033]16162;A\007'
  _WAVETERM_SI_FIRSTPRECMD=0
}

_waveterm_si_preexec() {
  _waveterm_si_blocked && return
  local cmd="$1"
  local cmd_length=${#cmd}
  if [ "$cmd_length" -gt 8192 ]; then
    cmd=$(printf '# command too large (%d bytes)' "$cmd_length")
  fi
  local cmd64
  cmd64=$(printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n\r')
  if [ -n "$cmd64" ]; then
    printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64"
  else
    printf '\033]16162;C\007'
  fi
}

typeset -g WAVETERM_SI_INPUTEMPTY=1

_waveterm_si_inputempty() {
  _waveterm_si_blocked && return
  
  local current_empty=1
  if [[ -n "$BUFFER" ]]; then
    current_empty=0
  fi
  
  if (( current_empty != WAVETERM_SI_INPUTEMPTY )); then
    WAVETERM_SI_INPUTEMPTY=$current_empty
    if (( current_empty )); then
      printf '\033]16162;I;{"inputempty":true}\007'
    else
      printf '\033]16162;I;{"inputempty":false}\007'
    fi
  fi
}

autoload -Uz add-zle-hook-widget 2>/dev/null
if (( $+functions[add-zle-hook-widget] )); then
  add-zle-hook-widget zle-line-init _waveterm_si_inputempty
  add-zle-hook-widget zle-line-pre-redraw _waveterm_si_inputempty
fi

autoload -U add-zsh-hook
add-zsh-hook precmd  _waveterm_si_precmd
add-zsh-hook preexec _waveterm_si_preexec
add-zsh-hook chpwd   _waveterm_si_osc7