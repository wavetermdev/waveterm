// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import (
	"errors"
	"fmt"
)

// CodedError wraps an error with a string code for categorization.
// The code can be extracted from anywhere in an error chain using GetErrorCode.
// SubCode provides additional granularity for error classification.
type CodedError struct {
	Code    string
	SubCode string
	Err     error
}

func (e CodedError) Error() string {
	return e.Err.Error()
}

func (e CodedError) Unwrap() error {
	return e.Err
}

// MakeCodedError creates a new CodedError with the given code and error.
func MakeCodedError(code string, err error) CodedError {
	return CodedError{Code: code, SubCode: "", Err: err}
}

// MakeSubCodedError creates a new CodedError with the given code, subcode, and error.
func MakeSubCodedError(code string, subCode string, err error) CodedError {
	return CodedError{Code: code, SubCode: subCode, Err: err}
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

// GetErrorSubCode extracts the error subcode from anywhere in the error chain.
// Returns empty string if no CodedError is found or if SubCode is not set.
func GetErrorSubCode(err error) string {
	if err == nil {
		return ""
	}
	var coded CodedError
	if errors.As(err, &coded) {
		return coded.SubCode
	}
	return ""
}

// Errorf creates a formatted error wrapped in a CodedError.
// This is a convenience function that combines fmt.Errorf with MakeCodedError.
func Errorf(code string, format string, args ...interface{}) error {
	return MakeCodedError(code, fmt.Errorf(format, args...))
}
