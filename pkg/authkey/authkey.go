// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package authkey

import (
	"fmt"
	"net/http"
	"os"
)

var authkey string

const WaveAuthKeyEnv = "WAVETERM_AUTH_KEY"
const AuthKeyHeader = "X-AuthKey"

func ValidateIncomingRequest(r *http.Request) error {
	reqAuthKey := r.Header.Get(AuthKeyHeader)
	if reqAuthKey == "" {
		return fmt.Errorf("no x-authkey header")
	}
	if reqAuthKey != GetAuthKey() {
		return fmt.Errorf("x-authkey header is invalid")
	}
	return nil
}

func SetAuthKeyFromEnv() error {
	authkey = os.Getenv(WaveAuthKeyEnv)
	if authkey == "" {
		return fmt.Errorf("no auth key found in environment variables")
	}
	os.Unsetenv(WaveAuthKeyEnv)
	return nil
}

func GetAuthKey() string {
	return authkey
}
