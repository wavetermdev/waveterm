#!/bin/bash

cd "$(dirname "$0")"
source testutil.sh

for fname in cases/*.sh; do
    setup_testcp
    #"${fname}" | read outerr && printf "\e[32mPASS $fname\n\n\e[0m" || printf "\e[31mFAIL $fname: $outerr \n\n\e[0m"
    if ! outerr=$("${fname}" 2>&1); then
        printf "\e[31mFAIL $fname:\n$outerr \n\n\e[0m"
    else
        printf "\e[32mPASS $fname\n\n\e[0m"
    fi
    cleanup_testcp
done