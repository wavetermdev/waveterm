// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"math"
	"testing"
)

func TestCalculateLuminance(t *testing.T) {
	tests := []struct {
		name     string
		hexColor string
		expected float64
		delta    float64 // Allowable delta for floating point comparison
	}{
		{
			name:     "pure white",
			hexColor: "#FFFFFF",
			expected: 1.0,
			delta:    0.001,
		},
		{
			name:     "pure black",
			hexColor: "#000000",
			expected: 0.0,
			delta:    0.001,
		},
		{
			name:     "pure red",
			hexColor: "#FF0000",
			expected: 0.2126, // Red coefficient in luminance formula
			delta:    0.001,
		},
		{
			name:     "pure green",
			hexColor: "#00FF00",
			expected: 0.7152, // Green coefficient in luminance formula
			delta:    0.001,
		},
		{
			name:     "pure blue",
			hexColor: "#0000FF",
			expected: 0.0722, // Blue coefficient in luminance formula
			delta:    0.001,
		},
		{
			name:     "mid gray",
			hexColor: "#808080",
			expected: 0.2159, // Approximately, due to gamma correction
			delta:    0.01,
		},
		{
			name:     "without hash prefix",
			hexColor: "FFFFFF",
			expected: 1.0,
			delta:    0.001,
		},
		{
			name:     "lowercase hex",
			hexColor: "#ffffff",
			expected: 1.0,
			delta:    0.001,
		},
		{
			name:     "yellow (light color)",
			hexColor: "#FFFF00",
			expected: 0.9278, // Red + Green luminance
			delta:    0.01,
		},
		{
			name:     "dark blue",
			hexColor: "#00008B",
			expected: 0.0182,
			delta:    0.01,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CalculateLuminance(tt.hexColor)
			if math.Abs(result-tt.expected) > tt.delta {
				t.Errorf("CalculateLuminance(%s) = %v, expected %v (delta: %v)",
					tt.hexColor, result, tt.expected, tt.delta)
			}
		})
	}
}

func TestCalculateLuminance_InvalidInput(t *testing.T) {
	tests := []struct {
		name     string
		hexColor string
		expected float64
	}{
		{
			name:     "empty string",
			hexColor: "",
			expected: 0,
		},
		{
			name:     "too short",
			hexColor: "#FFF",
			expected: 0,
		},
		{
			name:     "too long",
			hexColor: "#FFFFFFFF",
			expected: 0,
		},
		{
			name:     "invalid hex characters",
			hexColor: "#GGGGGG",
			expected: 0,
		},
		{
			name:     "partial invalid hex",
			hexColor: "#FFGGFF",
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CalculateLuminance(tt.hexColor)
			if result != tt.expected {
				t.Errorf("CalculateLuminance(%s) = %v, expected %v",
					tt.hexColor, result, tt.expected)
			}
		})
	}
}

func TestIsLightColor(t *testing.T) {
	tests := []struct {
		name     string
		hexColor string
		isLight  bool
	}{
		{
			name:     "white is light",
			hexColor: "#FFFFFF",
			isLight:  true,
		},
		{
			name:     "black is dark",
			hexColor: "#000000",
			isLight:  false,
		},
		{
			name:     "yellow is light",
			hexColor: "#FFFF00",
			isLight:  true,
		},
		{
			name:     "cyan is light",
			hexColor: "#00FFFF",
			isLight:  true,
		},
		{
			name:     "dark blue is dark",
			hexColor: "#00008B",
			isLight:  false,
		},
		{
			name:     "dark red is dark",
			hexColor: "#8B0000",
			isLight:  false,
		},
		{
			name:     "light gray is dark", // 0x80 = 128, which is below the 0.5 threshold after gamma
			hexColor: "#808080",
			isLight:  false,
		},
		{
			name:     "bright gray is light",
			hexColor: "#CCCCCC",
			isLight:  true,
		},
		{
			name:     "pure green is light", // Green has highest luminance coefficient
			hexColor: "#00FF00",
			isLight:  true,
		},
		{
			name:     "pure red is dark", // Red alone doesn't reach 0.5 luminance
			hexColor: "#FF0000",
			isLight:  false,
		},
		{
			name:     "pure blue is dark", // Blue has lowest luminance coefficient
			hexColor: "#0000FF",
			isLight:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsLightColor(tt.hexColor)
			if result != tt.isLight {
				luminance := CalculateLuminance(tt.hexColor)
				t.Errorf("IsLightColor(%s) = %v, expected %v (luminance: %.4f)",
					tt.hexColor, result, tt.isLight, luminance)
			}
		})
	}
}

func TestLinearize(t *testing.T) {
	// Test the linearization function for sRGB to linear RGB conversion
	tests := []struct {
		name     string
		input    float64
		expected float64
		delta    float64
	}{
		{
			name:     "zero",
			input:    0.0,
			expected: 0.0,
			delta:    0.0001,
		},
		{
			name:     "one",
			input:    1.0,
			expected: 1.0,
			delta:    0.0001,
		},
		{
			name:     "below threshold (0.03)",
			input:    0.03,
			expected: 0.03 / 12.92,
			delta:    0.0001,
		},
		{
			name:     "above threshold (0.5)",
			input:    0.5,
			expected: 0.2140, // Calculated value for gamma correction
			delta:    0.001,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := linearize(tt.input)
			if math.Abs(result-tt.expected) > tt.delta {
				t.Errorf("linearize(%v) = %v, expected %v",
					tt.input, result, tt.expected)
			}
		})
	}
}
