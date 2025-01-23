// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package colprint

import (
	"fmt"
	"io"
)

// formatFn is a function that converts a value of type T to its string representation
type formatFn[T any] func(T) (string, error)

type formatFnArray[T any] func(T) ([]string, error)

func PrintColumnsArray[T any](values <-chan T, numCols int, sampleSize int, format formatFnArray[T], w io.Writer) error {
	// Get first batch and determine column width
	maxLen := 0
	var samples []T

	for v := range values {
		samples = append(samples, v)
		str, err := format(v)
		if err != nil {
			return err
		}
		for _, s := range str {
			if len(s) > maxLen {
				maxLen = len(s)
			}
		}
		if len(samples) >= sampleSize {
			break
		}
	}

	colWidth := maxLen + 2 // Add minimum padding
	if colWidth < 1 {
		colWidth = 1
	}

	// Print in columns using our determined width
	col := 0
	for _, v := range samples {
		str, err := format(v)
		if err != nil {
			return err
		}
		for _, s := range str {
			if err := printColHelper(s, colWidth, &col, numCols, w); err != nil {
				return err
			}
		}
	}

	// Continue with any remaining values
	for v := range values {
		str, err := format(v)
		if err != nil {
			return err
		}
		for _, s := range str {
			if err := printColHelper(s, colWidth, &col, numCols, w); err != nil {
				return err
			}
		}
	}

	if col > 0 {
		if _, err := fmt.Fprint(w, "\n"); err != nil {
			return err
		}
	}
	return nil
}

// PrintColumns prints values in columns, adapting to long values by letting them span multiple columns
func PrintColumns[T any](values <-chan T, numCols int, sampleSize int, format formatFn[T], w io.Writer) error {
	// Get first batch and determine column width
	maxLen := 0
	var samples []T

	for v := range values {
		samples = append(samples, v)
		str, err := format(v)
		if err != nil {
			return err
		}
		if len(str) > maxLen {
			maxLen = len(str)
		}
		if len(samples) >= sampleSize {
			break
		}
	}

	colWidth := maxLen + 2 // Add minimum padding
	if colWidth < 1 {
		colWidth = 1
	}

	// Print in columns using our determined width
	col := 0
	for _, v := range samples {
		str, err := format(v)
		if err != nil {
			return err
		}
		if err := printColHelper(str, colWidth, &col, numCols, w); err != nil {
			return err
		}
	}

	// Continue with any remaining values
	for v := range values {
		str, err := format(v)
		if err != nil {
			return err
		}
		if err := printColHelper(str, colWidth, &col, numCols, w); err != nil {
			return err
		}
	}

	if col > 0 {
		if _, err := fmt.Fprint(w, "\n"); err != nil {
			return err
		}
	}
	return nil
}

func printColHelper(str string, colWidth int, col *int, numCols int, w io.Writer) error {
	nameColSpan := (len(str) + 1) / colWidth
	if (len(str)+1)%colWidth != 0 {
		nameColSpan++
	}

	if *col+nameColSpan > numCols {
		if _, err := fmt.Fprint(w, "\n"); err != nil {
			return err
		}
		*col = 0
	}

	if _, err := fmt.Fprintf(w, "%-*s", nameColSpan*colWidth, str); err != nil {
		return err
	}
	*col += nameColSpan
	return nil
}
