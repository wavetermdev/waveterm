package base

import "fmt"

type CodedError struct {
	ErrorCode string
	Err       error
}

func (c *CodedError) Error() string {
	return fmt.Sprintf("%s %s", c.ErrorCode, c.Err.Error())
}

func (c *CodedError) Unwrap() error {
	return c.Err
}

func MakeCodedError(code string, err error) *CodedError {
	return &CodedError{
		ErrorCode: code,
		Err:       err,
	}
}

func CodedErrorf(code string, format string, args ...interface{}) *CodedError {
	return &CodedError{
		ErrorCode: code,
		Err:       fmt.Errorf(format, args...),
	}
}

func GetErrorCode(err error) string {
	if codedErr, ok := err.(*CodedError); ok {
		return codedErr.ErrorCode
	}
	return ""
}
