// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"math"
	"strconv"
	"strings"
)

// CalculateLuminance calculates the relative luminance of a hex color
// using the sRGB color space formula from WCAG 2.0
func CalculateLuminance(hexColor string) float64 {
	hex := strings.TrimPrefix(hexColor, "#")
	if len(hex) != 6 {
		return 0
	}

	r, err := strconv.ParseInt(hex[0:2], 16, 64)
	if err != nil {
		return 0
	}
	g, err := strconv.ParseInt(hex[2:4], 16, 64)
	if err != nil {
		return 0
	}
	b, err := strconv.ParseInt(hex[4:6], 16, 64)
	if err != nil {
		return 0
	}

	rLin := linearize(float64(r) / 255.0)
	gLin := linearize(float64(g) / 255.0)
	bLin := linearize(float64(b) / 255.0)

	return 0.2126*rLin + 0.7152*gLin + 0.0722*bLin
}

// linearize converts sRGB color value to linear RGB
func linearize(c float64) float64 {
	if c <= 0.03928 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

// IsLightColor returns true if the color is light (luminance > 0.5)
// The 0.5 threshold is chosen as the midpoint of the relative luminance scale (0.0 to 1.0).
// This provides a balanced split between light and dark colors for optimal contrast:
// - Colors with luminance > 0.5 are considered "light" and need dark backgrounds
// - Colors with luminance <= 0.5 are considered "dark" and need light backgrounds
// This aligns with WCAG accessibility guidelines which use relative luminance for
// calculating contrast ratios between foreground and background colors.
func IsLightColor(hexColor string) bool {
	return CalculateLuminance(hexColor) > 0.5
}
