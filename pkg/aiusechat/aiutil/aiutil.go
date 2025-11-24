// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// ExtractXmlAttribute extracts an attribute value from an XML-like tag.
// Expects double-quoted strings where internal quotes are encoded as &quot;.
// Returns the unquoted value and true if found, or empty string and false if not found or invalid.
func ExtractXmlAttribute(tag, attrName string) (string, bool) {
	attrStart := strings.Index(tag, attrName+"=")
	if attrStart == -1 {
		return "", false
	}

	pos := attrStart + len(attrName+"=")
	start := strings.Index(tag[pos:], `"`)
	if start == -1 {
		return "", false
	}
	start += pos

	end := strings.Index(tag[start+1:], `"`)
	if end == -1 {
		return "", false
	}
	end += start + 1

	quotedValue := tag[start : end+1]
	value, err := strconv.Unquote(quotedValue)
	if err != nil {
		return "", false
	}

	value = strings.ReplaceAll(value, "&quot;", `"`)
	return value, true
}

// GenerateDeterministicSuffix creates an 8-character hash from input strings
func GenerateDeterministicSuffix(inputs ...string) string {
	hasher := sha256.New()
	for _, input := range inputs {
		hasher.Write([]byte(input))
	}
	hash := hasher.Sum(nil)
	return hex.EncodeToString(hash)[:8]
}

// ExtractImageUrl extracts an image URL from either URL field (http/https/data) or raw Data
func ExtractImageUrl(data []byte, url, mimeType string) (string, error) {
	if url != "" {
		if !strings.HasPrefix(url, "data:") &&
			!strings.HasPrefix(url, "http://") &&
			!strings.HasPrefix(url, "https://") {
			return "", fmt.Errorf("unsupported URL protocol in file part: %s", url)
		}
		return url, nil
	}
	if len(data) > 0 {
		base64Data := base64.StdEncoding.EncodeToString(data)
		return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
	}
	return "", fmt.Errorf("file part missing both url and data")
}

// ExtractTextData extracts text data from either Data field or URL field (data: URLs only)
func ExtractTextData(data []byte, url string) ([]byte, error) {
	if len(data) > 0 {
		return data, nil
	}
	if url != "" {
		if strings.HasPrefix(url, "data:") {
			_, decodedData, err := utilfn.DecodeDataURL(url)
			if err != nil {
				return nil, fmt.Errorf("failed to decode data URL for text/plain file: %w", err)
			}
			return decodedData, nil
		}
		return nil, fmt.Errorf("dropping text/plain file with URL (must be fetched and converted to data)")
	}
	return nil, fmt.Errorf("text/plain file part missing data")
}

// FormatAttachedTextFile formats a text file attachment with proper encoding and deterministic suffix
func FormatAttachedTextFile(fileName string, textContent []byte) string {
	if fileName == "" {
		fileName = "untitled.txt"
	}

	encodedFileName := strings.ReplaceAll(fileName, `"`, "&quot;")
	quotedFileName := strconv.Quote(encodedFileName)

	textStr := string(textContent)
	deterministicSuffix := GenerateDeterministicSuffix(textStr, fileName)
	return fmt.Sprintf("<AttachedTextFile_%s file_name=%s>\n%s\n</AttachedTextFile_%s>", deterministicSuffix, quotedFileName, textStr, deterministicSuffix)
}

// FormatAttachedDirectoryListing formats a directory listing attachment with proper encoding and deterministic suffix
func FormatAttachedDirectoryListing(directoryName, jsonContent string) string {
	if directoryName == "" {
		directoryName = "unnamed-directory"
	}

	encodedDirName := strings.ReplaceAll(directoryName, `"`, "&quot;")
	quotedDirName := strconv.Quote(encodedDirName)

	deterministicSuffix := GenerateDeterministicSuffix(jsonContent, directoryName)
	return fmt.Sprintf("<AttachedDirectoryListing_%s directory_name=%s>\n%s\n</AttachedDirectoryListing_%s>", deterministicSuffix, quotedDirName, jsonContent, deterministicSuffix)
}

// ConvertDataUserFile converts OpenAI attached file/directory blocks to UIMessagePart
// Returns (found, part) where found indicates if the prefix was matched,
// and part is the converted UIMessagePart (can be nil if parsing failed)
func ConvertDataUserFile(blockText string) (bool, *uctypes.UIMessagePart) {
	if strings.HasPrefix(blockText, "<AttachedTextFile_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		fileName, ok := ExtractXmlAttribute(openTag, "file_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: fileName,
				MimeType: "text/plain",
			},
		}
	}

	if strings.HasPrefix(blockText, "<AttachedDirectoryListing_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		directoryName, ok := ExtractXmlAttribute(openTag, "directory_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: directoryName,
				MimeType: "directory",
			},
		}
	}

	return false, nil
}

func JsonEncodeRequestBody(reqBody any) (bytes.Buffer, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(reqBody)
	if err != nil {
		return buf, err
	}
	return buf, nil
}

func IsOpenAIReasoningModel(model string) bool {
	m := strings.ToLower(model)
	return strings.HasPrefix(m, "o1") ||
		strings.HasPrefix(m, "o3") ||
		strings.HasPrefix(m, "o4") ||
		strings.HasPrefix(m, "gpt-5") ||
		strings.HasPrefix(m, "gpt-5.1")
}
