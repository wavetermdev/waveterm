// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const MaxImageSize = 10 * 1024 * 1024  // 10MB
const MaxPDFSize = 5 * 1024 * 1024     // 5MB
const MaxImageDimension = 4096         // Max dimension for resized images

type readMediaFileParams struct {
	Filename string `json:"filename"`
}

func parseReadMediaFileInput(input any) (*readMediaFileParams, error) {
	result := &readMediaFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	inputMap, ok := input.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid input format")
	}

	filename, ok := inputMap["filename"].(string)
	if !ok || filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}
	result.Filename = filename

	return result, nil
}

// detectMimeType detects the MIME type of a file based on extension and content
func detectMimeType(filePath string, initialBytes []byte) (string, error) {
	// Try extension-based detection first
	ext := strings.ToLower(filepath.Ext(filePath))
	if mimeType, ok := fileutil.StaticMimeTypeMap[ext]; ok {
		return mimeType, nil
	}

	// Fall back to content-based detection
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		// Use http.DetectContentType as last resort
		mimeType = "application/octet-stream"
		if len(initialBytes) > 0 {
			detected := mime.TypeByExtension(ext)
			if detected == "" {
				// Simple heuristics for common types
				if bytes.HasPrefix(initialBytes, []byte{0x89, 'P', 'N', 'G'}) {
					return "image/png", nil
				} else if bytes.HasPrefix(initialBytes, []byte{0xFF, 0xD8, 0xFF}) {
					return "image/jpeg", nil
				} else if bytes.HasPrefix(initialBytes, []byte("GIF8")) {
					return "image/gif", nil
				} else if bytes.HasPrefix(initialBytes, []byte("RIFF")) && len(initialBytes) > 12 && bytes.Equal(initialBytes[8:12], []byte("WEBP")) {
					return "image/webp", nil
				} else if bytes.HasPrefix(initialBytes, []byte("%PDF")) {
					return "application/pdf", nil
				}
			}
		}
	}

	return mimeType, nil
}

// isImageMimeType checks if a MIME type is an image
func isImageMimeType(mimeType string) bool {
	return strings.HasPrefix(mimeType, "image/")
}

// isPDFMimeType checks if a MIME type is PDF
func isPDFMimeType(mimeType string) bool {
	return mimeType == "application/pdf"
}

// resizeImage resizes an image to fit within MaxImageDimension while maintaining aspect ratio
// Uses nearest-neighbor resampling (simple but fast)
func resizeImage(img image.Image, maxDimension int) image.Image {
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// If image is already small enough, return it as-is
	if width <= maxDimension && height <= maxDimension {
		return img
	}

	// Calculate new dimensions while maintaining aspect ratio
	var newWidth, newHeight int
	if width > height {
		newWidth = maxDimension
		newHeight = (height * maxDimension) / width
	} else {
		newHeight = maxDimension
		newWidth = (width * maxDimension) / height
	}

	// Create new image with nearest-neighbor scaling
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	
	// Simple scaling using nearest-neighbor
	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			srcX := x * width / newWidth
			srcY := y * height / newHeight
			dst.Set(x, y, img.At(srcX+bounds.Min.X, srcY+bounds.Min.Y))
		}
	}
	
	return dst
}

// decodeImage decodes an image from bytes, supporting multiple formats
func decodeImage(data []byte, mimeType string) (image.Image, error) {
	reader := bytes.NewReader(data)
	
	switch mimeType {
	case "image/png":
		return png.Decode(reader)
	case "image/jpeg", "image/jpg":
		return jpeg.Decode(reader)
	case "image/gif":
		return gif.Decode(reader)
	default:
		// Try generic decode for other formats
		img, _, err := image.Decode(reader)
		return img, err
	}
}

// encodeImageAsJPEG encodes an image as JPEG with quality optimization
func encodeImageAsJPEG(img image.Image) ([]byte, string, error) {
	var buf bytes.Buffer
	
	// Use JPEG with 80% quality for good compression while maintaining quality
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80})
	if err != nil {
		return nil, "", fmt.Errorf("failed to encode image: %w", err)
	}
	
	return buf.Bytes(), "image/jpeg", nil
}

func readMediaFileCallback(input any) (string, error) {
	params, err := parseReadMediaFileInput(input)
	if err != nil {
		return "", err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return "", fmt.Errorf("failed to expand path: %w", err)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return "", fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return "", fmt.Errorf("path is a directory, cannot be read as a media file")
	}

	// Read initial bytes for MIME type detection
	file, err := os.Open(expandedPath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	initialBuf := make([]byte, 512)
	n, _ := file.Read(initialBuf)
	initialBuf = initialBuf[:n]

	// Detect MIME type
	mimeType, err := detectMimeType(expandedPath, initialBuf)
	if err != nil {
		return "", fmt.Errorf("failed to detect MIME type: %w", err)
	}

	// Check if file type is supported
	if !isImageMimeType(mimeType) && !isPDFMimeType(mimeType) {
		return "", fmt.Errorf("unsupported file type: %s (only images and PDFs are supported)", mimeType)
	}

	// Check size limits
	fileSize := fileInfo.Size()
	if isImageMimeType(mimeType) && fileSize > MaxImageSize {
		return "", fmt.Errorf("image file too large: %d bytes (max %d bytes)", fileSize, MaxImageSize)
	}
	if isPDFMimeType(mimeType) && fileSize > MaxPDFSize {
		return "", fmt.Errorf("PDF file too large: %d bytes (max %d bytes)", fileSize, MaxPDFSize)
	}

	// Read entire file
	if _, err := file.Seek(0, 0); err != nil {
		return "", fmt.Errorf("failed to seek to start of file: %w", err)
	}

	fileData, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	// For images, resize if necessary
	if isImageMimeType(mimeType) {
		img, err := decodeImage(fileData, mimeType)
		if err != nil {
			// If decode fails, just return the original data
			// (might be an SVG or other format we don't process)
			base64Data := base64.StdEncoding.EncodeToString(fileData)
			return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
		}

		// Resize if needed
		resizedImg := resizeImage(img, MaxImageDimension)
		
		// Encode resized image as JPEG
		encodedData, encodedMimeType, err := encodeImageAsJPEG(resizedImg)
		if err != nil {
			return "", fmt.Errorf("failed to encode resized image: %w", err)
		}

		// Only use resized version if it's smaller
		if len(encodedData) < len(fileData) {
			fileData = encodedData
			mimeType = encodedMimeType
		}
	}

	// Return as data URL
	base64Data := base64.StdEncoding.EncodeToString(fileData)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}

func GetReadMediaFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_media_file",
		DisplayName: "Read Image or PDF File",
		Description: "Read an image or PDF file from the filesystem and return it as a base64-encoded data URL. Images are automatically resized to a maximum dimension of 4096px if they exceed this size. Supports JPEG, PNG, GIF, and PDF files. Images must be under 10MB, PDFs under 5MB. Requires user approval.",
		ToolLogName: "gen:readmedia",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the image or PDF file to read",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			parsed, err := parseReadMediaFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading media file %q", parsed.Filename)
		},
		ToolTextCallback: readMediaFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
