package cmdrunner

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
)

// PTERM=WxH,Wx25
// PTERM="Wx25!"
// PTERM=80x25,80x35

type PTermOptsType struct {
	Rows     string
	RowsFlex bool
	Cols     string
	ColsFlex bool
}

const PTermMax = "M"

func isDigits(s string) bool {
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func atoiDefault(s string, def int) int {
	ival, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return ival
}

func parseTermPart(part string, partType string) (string, bool, error) {
	flex := true
	if strings.HasSuffix(part, "!") {
		part = part[:len(part)-1]
		flex = false
	}
	if part == "" {
		return PTermMax, flex, nil
	}
	if part == PTermMax {
		return PTermMax, flex, nil
	}
	if !isDigits(part) {
		return "", false, fmt.Errorf("invalid PTERM %s: must be '%s' or [number]", partType, PTermMax)
	}
	return part, flex, nil
}

func parseSingleTermStr(s string) (*PTermOptsType, error) {
	s = strings.TrimSpace(s)
	xIdx := strings.Index(s, "x")
	if xIdx == -1 {
		return nil, fmt.Errorf("invalid PTERM, must include 'x' to separate width and height (e.g. WxH)")
	}
	rowsPart := s[0:xIdx]
	colsPart := s[xIdx+1:]
	rows, rowsFlex, err := parseTermPart(rowsPart, "rows")
	if err != nil {
		return nil, err
	}
	cols, colsFlex, err := parseTermPart(colsPart, "cols")
	if err != nil {
		return nil, err
	}
	return &PTermOptsType{Rows: rows, RowsFlex: rowsFlex, Cols: cols, ColsFlex: colsFlex}, nil
}

func GetUITermOpts(winSize *packet.WinSize, ptermStr string) (*packet.TermOpts, error) {
	opts, err := parseSingleTermStr(ptermStr)
	if err != nil {
		return nil, err
	}
	termOpts := &packet.TermOpts{Rows: shexec.DefaultTermRows, Cols: shexec.DefaultTermCols, Term: remote.DefaultTerm, MaxPtySize: shexec.DefaultMaxPtySize}
	if winSize == nil {
		winSize = &packet.WinSize{Rows: shexec.DefaultTermRows, Cols: shexec.DefaultTermCols}
	}
	if winSize.Rows == 0 {
		winSize.Rows = shexec.DefaultTermRows
	}
	if winSize.Cols == 0 {
		winSize.Cols = shexec.DefaultTermCols
	}
	if opts.Rows == PTermMax {
		termOpts.Rows = winSize.Rows
	} else {
		termOpts.Rows = atoiDefault(opts.Rows, termOpts.Rows)
	}
	if opts.Cols == PTermMax {
		termOpts.Cols = winSize.Cols
	} else {
		termOpts.Cols = atoiDefault(opts.Cols, termOpts.Cols)
	}
	termOpts.MaxPtySize = base.BoundInt64(termOpts.MaxPtySize, shexec.MinMaxPtySize, shexec.MaxMaxPtySize)
	termOpts.Cols = base.BoundInt(termOpts.Cols, shexec.MinTermCols, shexec.MaxTermCols)
	termOpts.Rows = base.BoundInt(termOpts.Rows, shexec.MinTermRows, shexec.MaxTermRows)
	return termOpts, nil
}
