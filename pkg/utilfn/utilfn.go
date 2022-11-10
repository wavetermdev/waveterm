package utilfn

import (
	"strings"

	"github.com/alessio/shellescape"
)

func GetStrArr(v interface{}, field string) []string {
	if v == nil {
		return nil
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return nil
	}
	iarr, ok := fieldVal.([]interface{})
	if !ok {
		return nil
	}
	var sarr []string
	for _, iv := range iarr {
		if sv, ok := iv.(string); ok {
			sarr = append(sarr, sv)
		}
	}
	return sarr
}

func GetBool(v interface{}, field string) bool {
	if v == nil {
		return false
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return false
	}
	bval, ok := fieldVal.(bool)
	if !ok {
		return false
	}
	return bval
}

// minimum maxlen=6
func ShellQuote(val string, forceQuote bool, maxLen int) string {
	if maxLen < 6 {
		maxLen = 6
	}
	rtn := shellescape.Quote(val)
	if strings.HasPrefix(rtn, "\"") || strings.HasPrefix(rtn, "'") {
		if len(rtn) > maxLen {
			return rtn[0:maxLen-4] + "..." + rtn[0:1]
		}
		return rtn
	}
	if forceQuote {
		if len(rtn) > maxLen-2 {
			return "\"" + rtn[0:maxLen-5] + "...\""
		}
		return "\"" + rtn + "\""
	} else {
		if len(rtn) > maxLen {
			return rtn[0:maxLen-3] + "..."
		}
		return rtn
	}
}
