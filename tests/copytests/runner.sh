#!/bin/bash

cd "$(dirname "$0")"
source testutil.sh

TOTAL_COPY_TESTS_RUN=0
TOTAL_COPY_TESTS_PASSED=0

for fname in cases/*.sh; do
    setup_testcp
    #"${fname}" | read outerr && printf "\e[32mPASS $fname\n\n\e[0m" || printf "\e[31mFAIL $fname: $outerr \n\n\e[0m"
    if ! outerr=$("${fname}" 2>&1); then
        printf "\e[31mFAIL $fname:\n$outerr \n\e[0m"
		cat "${fname}"
		printf "\n"
    else
        printf "\e[32mPASS $fname\n\n\e[0m"
        ((TOTAL_COPY_TESTS_PASSED++))
    fi
    cleanup_testcp
	((TOTAL_COPY_TESTS_RUN++))
done

printf "\n\e[32m${TOTAL_COPY_TESTS_PASSED} of ${TOTAL_COPY_TESTS_RUN} Tests Passed \e[0m\n\n"