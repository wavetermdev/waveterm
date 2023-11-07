#!/bin/bash

if [ ! -d ~/prompt ]; then
    echo "~/prompt directory does not exist, will not migrate"
    exit 1;
fi
if [ -d ~/.waveterm ]; then
    echo "~/.wave directory already exists, will not migrate"
    exit 1;
fi
mv ~/prompt ~/.waveterm
mv ~/.waveterm/prompt.db     ~/.waveterm/waveterm.db
mv ~/.waveterm/prompt.db-wal ~/.waveterm/waveterm.db-wal
mv ~/.waveterm/prompt.db-shm ~/.waveterm/waveterm.db-shm
mv prompt.authkey waveterm.authkey


