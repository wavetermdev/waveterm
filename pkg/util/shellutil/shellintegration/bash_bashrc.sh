
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