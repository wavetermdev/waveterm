
# Source /etc/profile if it exists
if [ -f /etc/profile ]; then
    . /etc/profile
fi

WAVETERM_WSHBINDIR={{.WSHBINDIR}}

# after /etc/profile which is likely to clobber the path
export PATH="$WAVETERM_WSHBINDIR:$PATH"

# Source the dynamic script from wsh token
eval "$(wsh token "$WAVETERM_SWAPTOKEN" bash 2> /dev/null)"
unset WAVETERM_SWAPTOKEN

# Source the first of ~/.bash_profile, ~/.bash_login, or ~/.profile that exists
if [ -f ~/.bash_profile ]; then
    . ~/.bash_profile
elif [ -f ~/.bash_login ]; then
    . ~/.bash_login
elif [ -f ~/.profile ]; then
    . ~/.profile
fi

if [[ ":$PATH:" != *":$WAVETERM_WSHBINDIR:"* ]]; then
    export PATH="$WAVETERM_WSHBINDIR:$PATH"
fi
unset WAVETERM_WSHBINDIR
if type _init_completion &>/dev/null; then
  source <(wsh completion bash)
fi

# shell integration
_waveterm_si_blocked() {
  [[ -n "$TMUX" || -n "$STY" || "$TERM" == tmux* || "$TERM" == screen* ]]
}

_waveterm_si_urlencode() {
  local s="$1"
  # Escape % first
  s="${s//%/%25}"
  # Common reserved characters in file paths
  s="${s// /%20}"
  s="${s//#/%23}"
  s="${s//\?/%3F}"
  s="${s//&/%26}"
  s="${s//;/%3B}"
  s="${s//+/%2B}"
  printf '%s' "$s"
}

_waveterm_si_osc7() {
  _waveterm_si_blocked && return
  local encoded_pwd=$(_waveterm_si_urlencode "$PWD")
  printf '\033]7;file://%s%s\007' "$HOSTNAME" "$encoded_pwd"
}

# Hook OSC 7 into PROMPT_COMMAND
_waveterm_si_prompt_command() {
  _waveterm_si_osc7
}

# Append _waveterm_si_prompt_command to PROMPT_COMMAND (v3-safe)
_waveterm_si_append_pc() {
  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
    PROMPT_COMMAND+=(_waveterm_si_prompt_command)
  else
    PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_waveterm_si_prompt_command"
  fi
}
_waveterm_si_append_pc