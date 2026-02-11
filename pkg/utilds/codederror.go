// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import (
	"errors"
	"fmt"
)

// CodedError wraps an error with a string code for categorization.
// The code can be extracted from anywhere in an error chain using GetErrorCode.
type CodedError struct {
	Code string
	Err  error
}

func (e CodedError) Error() string {
	return e.Err.Error()
}

func (e CodedError) Unwrap() error {
	return e.Err
}

// MakeCodedError creates a new CodedError with the given code and error.
func MakeCodedError(code string, err error) CodedError {
	return CodedError{Code: code, Err: err}
}

// GetErrorCode extracts the error code from anywhere in the error chain.
// Returns empty string if no CodedError is found.
func GetErrorCode(err error) string {
	if err == nil {
		return ""
	}
	var coded CodedError
	if errors.As(err, &coded) {
		return coded.Code
	}
	return ""
}

// Errorf creates a formatted error wrapped in a CodedError.
// This is a convenience function that combines fmt.Errorf with MakeCodedError.
func Errorf(code string, format string, args ...interface{}) error {
	return MakeCodedError(code, fmt.Errorf(format, args...))
}
