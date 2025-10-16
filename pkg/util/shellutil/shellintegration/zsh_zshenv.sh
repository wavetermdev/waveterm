# Store the initial ZDOTDIR value
WAVETERM_ZDOTDIR="$ZDOTDIR"

# Source the original zshenv
[ -f ~/.zshenv ] && source ~/.zshenv

# Detect if ZDOTDIR has changed
if [ "$ZDOTDIR" != "$WAVETERM_ZDOTDIR" ]; then
  # If changed, manually source your custom zshrc from the original WAVETERM_ZDOTDIR
  [ -f "$WAVETERM_ZDOTDIR/.zshrc" ] && source "$WAVETERM_ZDOTDIR/.zshrc"
fi