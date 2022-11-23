package simpleexpand

import (
	"bytes"
	"strings"

	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
)

type SimpleExpandContext struct {
	HomeDir string
}

type SimpleExpandInfo struct {
	HasTilde   bool // only ~ as the first character when SimpleExpandContext.HomeDir is set
	HasVar     bool // $x, $$, ${...}
	HasGlob    bool // *, ?, [, {
	HasExtGlob bool // ?(...) ... ?*+@!
	HasHistory bool // ! (anywhere)
	HasSpecial bool // subshell, arith
}

func expandHomeDir(info *SimpleExpandInfo, litVal string, multiPart bool, homeDir string) string {
	if homeDir == "" {
		return litVal
	}
	if litVal == "~" && !multiPart {
		return homeDir
	}
	if strings.HasPrefix(litVal, "~/") {
		info.HasTilde = true
		return homeDir + litVal[1:]
	}
	return litVal
}

func expandLiteral(buf *bytes.Buffer, info *SimpleExpandInfo, litVal string) {
	var lastBackSlash bool
	var lastExtGlob bool
	var lastDollar bool
	for _, ch := range litVal {
		if ch == 0 {
			break
		}
		if lastBackSlash {
			lastBackSlash = false
			if ch == '\n' {
				// special case, backslash *and* newline are ignored
				continue
			}
			buf.WriteRune(ch)
			continue
		}
		if ch == '\\' {
			lastBackSlash = true
			lastExtGlob = false
			lastDollar = false
			continue
		}
		if ch == '*' || ch == '?' || ch == '[' || ch == '{' {
			info.HasGlob = true
		}
		if ch == '`' {
			info.HasSpecial = true
		}
		if ch == '!' {
			info.HasHistory = true
		}
		if lastExtGlob && ch == '(' {
			info.HasExtGlob = true
		}
		if lastDollar && (ch != ' ' && ch != '"' && ch != '\'' && ch != '(' || ch != '[') {
			info.HasVar = true
		}
		if lastDollar && (ch == '(' || ch == '[') {
			info.HasSpecial = true
		}
		lastExtGlob = (ch == '?' || ch == '*' || ch == '+' || ch == '@' || ch == '!')
		lastDollar = (ch == '$')
		buf.WriteRune(ch)
	}
	if lastBackSlash {
		buf.WriteByte('\\')
	}
}

// also expands ~
func expandLiteralPlus(buf *bytes.Buffer, info *SimpleExpandInfo, litVal string, multiPart bool, ectx SimpleExpandContext) {
	litVal = expandHomeDir(info, litVal, multiPart, ectx.HomeDir)
	expandLiteral(buf, info, litVal)
}

func expandSQANSILiteral(buf *bytes.Buffer, litVal string) {
	// no info specials
	str, _, _ := expand.Format(nil, litVal, nil)
	buf.WriteString(str)
}

func expandSQLiteral(buf *bytes.Buffer, litVal string) {
	// no info specials
	buf.WriteString(litVal)
}

// will also work for partial double quoted strings
func expandDQLiteral(buf *bytes.Buffer, info *SimpleExpandInfo, litVal string) {
	var lastBackSlash bool
	var lastDollar bool
	for _, ch := range litVal {
		if ch == 0 {
			break
		}
		if lastBackSlash {
			lastBackSlash = false
			if ch == '"' || ch == '\\' || ch == '$' || ch == '`' {
				buf.WriteRune(ch)
				continue
			}
			buf.WriteRune('\\')
			buf.WriteRune(ch)
			continue
		}
		if ch == '\\' {
			lastBackSlash = true
			lastDollar = false
			continue
		}

		// similar to expandLiteral, but no globbing
		if ch == '`' {
			info.HasSpecial = true
		}
		if ch == '!' {
			info.HasHistory = true
		}
		if lastDollar && (ch != ' ' && ch != '"' && ch != '\'' && ch != '(' || ch != '[') {
			info.HasVar = true
		}
		if lastDollar && (ch == '(' || ch == '[') {
			info.HasSpecial = true
		}
		lastDollar = (ch == '$')
		buf.WriteRune(ch)
	}
	// in a valid parsed DQ string, you cannot have a trailing backslash (because \" would not end the string)
	// still putting the case here though in case we ever deal with incomplete strings (e.g. completion)
	if lastBackSlash {
		buf.WriteByte('\\')
	}
}

func simpleExpandWordInternal(buf *bytes.Buffer, info *SimpleExpandInfo, ectx SimpleExpandContext, parts []syntax.WordPart, sourceStr string, inDoubleQuote bool, level int) {
	for partIdx, untypedPart := range parts {
		switch part := untypedPart.(type) {
		case *syntax.Lit:
			if !inDoubleQuote && partIdx == 0 && level == 1 && ectx.HomeDir != "" {
				expandLiteralPlus(buf, info, part.Value, len(parts) > 1, ectx)
			} else if inDoubleQuote {
				expandDQLiteral(buf, info, part.Value)
			} else {
				expandLiteral(buf, info, part.Value)
			}

		case *syntax.SglQuoted:
			if part.Dollar {
				expandSQANSILiteral(buf, part.Value)
			} else {
				expandSQLiteral(buf, part.Value)
			}

		case *syntax.DblQuoted:
			simpleExpandWordInternal(buf, info, ectx, part.Parts, sourceStr, true, level+1)

		default:
			rawStr := sourceStr[part.Pos().Offset():part.End().Offset()]
			buf.WriteString(rawStr)
		}
	}
}

// simple word expansion
// expands: literals, single-quoted strings, double-quoted strings (recursively)
// does *not* expand: params (variables), command substitution, arithmetic expressions, process substituions, globs
// for the not expands, they will show up as the literal string
// this is different than expand.Literal which will replace variables as empty string if they aren't defined.
// so "a"'foo'${bar}$x => "afoo${bar}$x", but expand.Literal would produce => "afoo"
// note will do ~ expansion (will not do ~user expansion)
func SimpleExpandWord(ectx SimpleExpandContext, word *syntax.Word, sourceStr string) (string, SimpleExpandInfo) {
	var buf bytes.Buffer
	var info SimpleExpandInfo
	simpleExpandWordInternal(&buf, &info, ectx, word.Parts, sourceStr, false, 1)
	return buf.String(), info
}

func SimpleExpandPartialWord(ectx SimpleExpandContext, partialWord string, multiPart bool) (string, SimpleExpandInfo) {
	var buf bytes.Buffer
	var info SimpleExpandInfo
	if partialWord == "" {
		return "", info
	}
	if strings.HasPrefix(partialWord, "\"") {
		expandDQLiteral(&buf, &info, partialWord[1:])
	} else if strings.HasPrefix(partialWord, "$\"") {
		expandDQLiteral(&buf, &info, partialWord[2:])
	} else if strings.HasPrefix(partialWord, "'") {
		expandSQLiteral(&buf, partialWord[1:])
	} else if strings.HasPrefix(partialWord, "$'") {
		expandSQANSILiteral(&buf, partialWord[2:])
	} else {
		expandLiteralPlus(&buf, &info, partialWord, multiPart, ectx)
	}
	return buf.String(), info
}
