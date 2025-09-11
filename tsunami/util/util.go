package util

import (
	"encoding"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

// PanicHandler handles panic recovery and logging.
// It can be called directly with recover() without checking for nil first.
// Example usage:
//   defer func() {
//       util.PanicHandler("operation name", recover())
//   }()
func PanicHandler(debugStr string, recoverVal any) error {
	if recoverVal == nil {
		return nil
	}
	log.Printf("[panic] in %s: %v\n", debugStr, recoverVal)
	debug.PrintStack()
	if err, ok := recoverVal.(error); ok {
		return fmt.Errorf("panic in %s: %w", debugStr, err)
	}
	return fmt.Errorf("panic in %s: %v", debugStr, recoverVal)
}

func GetHomeDir() string {
	homeVar, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return homeVar
}

func ExpandHomeDir(pathStr string) (string, error) {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") && (!strings.HasPrefix(pathStr, `~\`) || runtime.GOOS != "windows") {
		return filepath.Clean(pathStr), nil
	}
	homeDir := GetHomeDir()
	if pathStr == "~" {
		return homeDir, nil
	}
	expandedPath := filepath.Clean(filepath.Join(homeDir, pathStr[2:]))
	absPath, err := filepath.Abs(filepath.Join(homeDir, expandedPath))
	if err != nil || !strings.HasPrefix(absPath, homeDir) {
		return "", fmt.Errorf("potential path traversal detected for path %s", pathStr)
	}
	return expandedPath, nil
}

func ExpandHomeDirSafe(pathStr string) string {
	path, _ := ExpandHomeDir(pathStr)
	return path
}

func ChunkSlice[T any](slice []T, chunkSize int) [][]T {
	if len(slice) == 0 {
		return nil
	}
	chunks := make([][]T, 0)
	for i := 0; i < len(slice); i += chunkSize {
		end := i + chunkSize
		if end > len(slice) {
			end = len(slice)
		}
		chunks = append(chunks, slice[i:end])
	}
	return chunks
}

func OpenBrowser(url string, delay time.Duration) {
	if delay > 0 {
		time.Sleep(delay)
	}

	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default: // "linux", "freebsd", "openbsd", "netbsd"
		cmd = "xdg-open"
		args = []string{url}
	}

	exec.Command(cmd, args...).Start()
}

func GetTypedAtomValue[T any](rawVal any, atomName string) T {
	var result T
	if rawVal == nil {
		return *new(T)
	}

	var ok bool
	result, ok = rawVal.(T)
	if !ok {
		// Try converting from float64 if rawVal is float64
		if f64Val, isFloat64 := rawVal.(float64); isFloat64 {
			if converted, convOk := FromFloat64[T](f64Val); convOk {
				return converted
			}
		}
		panic(fmt.Sprintf("GetTypedAtomValue %q value type mismatch (expected %T, got %T)", atomName, *new(T), rawVal))
	}
	return result
}

var (
	jsonMarshalerT = reflect.TypeOf((*json.Marshaler)(nil)).Elem()
	textMarshalerT = reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()
)

func implementsJSON(t reflect.Type) bool {
	if t.Implements(jsonMarshalerT) || t.Implements(textMarshalerT) {
		return true
	}
	if t.Kind() != reflect.Pointer {
		pt := reflect.PointerTo(t)
		return pt.Implements(jsonMarshalerT) || pt.Implements(textMarshalerT)
	}
	return false
}

func ValidateAtomType(t reflect.Type, atomName string) error {
	seen := make(map[reflect.Type]bool)
	return validateAtomTypeRecursive(t, seen, atomName, "")
}

func makeAtomError(atomName string, parentName string, message string) error {
	if parentName != "" {
		return fmt.Errorf("atom %s: in %s: %s", atomName, parentName, message)
	}
	return fmt.Errorf("atom %s: %s", atomName, message)
}

func validateAtomTypeRecursive(t reflect.Type, seen map[reflect.Type]bool, atomName string, parentName string) error {
	if t == nil {
		return makeAtomError(atomName, parentName, "nil type")
	}

	if seen[t] {
		return nil
	}
	seen[t] = true

	// Check if type implements json.Marshaler or encoding.TextMarshaler
	if implementsJSON(t) {
		return nil
	}

	switch t.Kind() {
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64, reflect.String:
		return nil

	case reflect.Ptr:
		return validateAtomTypeRecursive(t.Elem(), seen, atomName, parentName)

	case reflect.Array, reflect.Slice:
		elemType := t.Elem()
		// Allow []any as a JSON value slot
		if elemType.Kind() == reflect.Interface && elemType.NumMethod() == 0 {
			return nil
		}
		return validateAtomTypeRecursive(elemType, seen, atomName, parentName)

	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return makeAtomError(atomName, parentName, fmt.Sprintf("map key must be string, got %s", t.Key().Kind()))
		}
		elemType := t.Elem()
		// Allow map[string]any as a JSON value slot
		if elemType.Kind() == reflect.Interface && elemType.NumMethod() == 0 {
			return nil
		}
		return validateAtomTypeRecursive(elemType, seen, atomName, parentName)

	case reflect.Struct:
		structName := t.Name()
		if structName == "" {
			structName = "anonymous struct"
		}
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			fieldPath := fmt.Sprintf("%s.%s", structName, field.Name)

			if !field.IsExported() {
				return makeAtomError(atomName, fieldPath, "field is not exported (cannot round trip)")
			}

			// Check for json:"-" tag
			if tag := field.Tag.Get("json"); tag != "" {
				if name, _, _ := strings.Cut(tag, ","); name == "-" {
					return makeAtomError(atomName, fieldPath, `field has json:"-" (breaks round trip)`)
				}
			}

			if err := validateAtomTypeRecursive(field.Type, seen, atomName, fieldPath); err != nil {
				return err
			}
		}
		return nil

	case reflect.Interface:
		// Allow empty interface (any) as JSON value slot
		if t.NumMethod() == 0 {
			return nil
		}
		return makeAtomError(atomName, parentName, "non-empty interface types are not JSON serializable (cannot round trip)")

	case reflect.Func, reflect.Chan, reflect.UnsafePointer, reflect.Uintptr, reflect.Complex64, reflect.Complex128:
		return makeAtomError(atomName, parentName, fmt.Sprintf("type %s is not JSON serializable", t.Kind()))

	default:
		return makeAtomError(atomName, parentName, fmt.Sprintf("unsupported type %s", t.Kind()))
	}
}
