#!/bin/bash
# Launch Wave (dev build) with a separate data directory
# Double-click this file in Finder to launch, or run from terminal.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVETERM_HOME="$SCRIPT_DIR/.waveterm-dev"
WAVETERM_CONFIG_HOME="$WAVETERM_HOME/config"
WAVETERM_DATA_HOME="$WAVETERM_HOME/data"
export WAVETERM_HOME WAVETERM_CONFIG_HOME WAVETERM_DATA_HOME
exec "$SCRIPT_DIR/make/mac-arm64/Wave Dev.app/Contents/MacOS/Wave Dev"
