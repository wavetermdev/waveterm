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

_waveterm_si_precmd() {
  local _waveterm_si_status=$?
  _waveterm_si_blocked && return
  # D;status for previous command (skip before first prompt)
  if (( !_WAVETERM_SI_FIRSTPRECMD )); then
    printf '\033]16162;D;%d\007' $_waveterm_si_status
  fi
  printf '\033]16162;A\007'      # start of new prompt
  printf '\033]7;file://%s%s\007' "$HOST" "$PWD"  # OSC 7 - current directory
  _WAVETERM_SI_FIRSTPRECMD=0
}

_waveterm_si_preexec() {
  _waveterm_si_blocked && return
  printf '\033]16162;B\007'      # end of prompt
  printf '\033]16162;C\007'      # start of command output
}

autoload -U add-zsh-hook
add-zsh-hook precmd  _waveterm_si_precmd
add-zsh-hook preexec _waveterm_si_preexec