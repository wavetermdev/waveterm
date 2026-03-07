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

# fix history (macos)
if [[ "$HISTFILE" == "$WAVETERM_ZDOTDIR/.zsh_history" ]]; then
  HISTFILE="$HOME/.zsh_history"
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

_waveterm_si_compmode() {
  # fzf-based completion wins
  if typeset -f _fzf_tab_complete >/dev/null 2>&1 || typeset -f _fzf_complete >/dev/null 2>&1; then
    echo "fzf"
    return
  fi

  # Check zstyle menu setting
  local _menuval
  if zstyle -s ':completion:*' menu _menuval 2>/dev/null; then
    if [[ "$_menuval" == *select* ]]; then
      echo "menu-select"
    else
      echo "menu"
    fi
    return
  fi

  echo "standard"
}

_waveterm_si_osc7() {
  _waveterm_si_blocked && return
  local encoded_pwd=$(_waveterm_si_urlencode "$PWD")
  printf '\033]7;file://localhost%s\007' "$encoded_pwd"  # OSC 7 - current directory
}

_waveterm_si_precmd() {
  local _waveterm_si_status=$?
  _waveterm_si_blocked && return
  # D;status for previous command (skip before first prompt)
  if (( !_WAVETERM_SI_FIRSTPRECMD )); then
    printf '\033]16162;D;{"exitcode":%d}\007' "$_waveterm_si_status"
  else
    local uname_info=$(uname -smr 2>/dev/null)
    local omz=false
    local comp=$(_waveterm_si_compmode)
    [[ -n "$ZSH" && -r "$ZSH/oh-my-zsh.sh" ]] && omz=true
    printf '\033]16162;M;{"shell":"zsh","shellversion":"%s","uname":"%s","integration":true,"omz":%s,"comp":"%s"}\007' "$ZSH_VERSION" "$uname_info" "$omz" "$comp"
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

_waveterm_si_inputreadback() {
  _waveterm_si_blocked && return
  local buffer64 cursor
  buffer64=$(printf '%s' "$BUFFER" | base64 2>/dev/null | tr -d '\n\r')
  cursor=$CURSOR
  zle -I
  printf '\033]16162;I;{"buffer64":"%s","cursor":%d}\007' "$buffer64" "$cursor"
}

zle -N _waveterm_si_inputreadback
bindkey -M emacs '^_Wr' _waveterm_si_inputreadback 2>/dev/null
bindkey -M viins '^_Wr' _waveterm_si_inputreadback 2>/dev/null
bindkey -M vicmd '^_Wr' _waveterm_si_inputreadback 2>/dev/null

autoload -U add-zsh-hook
add-zsh-hook precmd  _waveterm_si_precmd
add-zsh-hook preexec _waveterm_si_preexec
add-zsh-hook chpwd   _waveterm_si_osc7
