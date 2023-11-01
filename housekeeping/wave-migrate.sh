#!/bin/bash

if [ ! -d ~/prompt ]; then
    echo "~/prompt directory does not exist, will not migrate"
    exit 1;
fi
if [ -d ~/.wave ]; then
    echo "~/.wave directory already exists, will not migrate"
    exit 1;
fi
mv ~/prompt ~/.wave
cd ~/.wave
mv prompt.db wave.db
mv prompt.db-wal wave.db-wal
mv prompt.db-shm wave.db-shm
mv prompt.authkey wave.authkey


