// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package promptenc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/url"
)

func ComputeUrlHmac(key []byte, baseUrl string, qvals url.Values) (string, error) {
	if qvals.Has("nonce") {
		return "", fmt.Errorf("nonce is required for hmac")
	}
	if qvals.Has("hmac") {
		return "", fmt.Errorf("hmac is already present")
	}
	encStr := baseUrl + "?" + qvals.Encode()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(encStr))
	rtn := mac.Sum(nil)
	return base64.URLEncoding.EncodeToString(rtn), nil
}

func copyUrlValues(src url.Values) url.Values {
	rtn := make(url.Values)
	for k, v := range src {
		rtn[k] = v
	}
	return rtn
}

func ValidateUrlHmac(key []byte, baseUrl string, qvalsOrig url.Values) (bool, error) {
	qvals := copyUrlValues(qvalsOrig)
	hmacStr := qvals.Get("hmac")
	if hmacStr == "" {
		return false, fmt.Errorf("no hmac key found"))
	}
	qvals.Del("hmac")
	encStr := baseUrl + "?" + qvals.Encode()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(encStr))
	expected := mac.Sum(nil)
	actual, err := base64.URLEncoding.DecodeString(hmacStr)
	if err != nil {
		return false, fmt.Errorf("error decoding hmac: %w", err)
	}
	return hmac.Equal(expected, actual), nil
}
