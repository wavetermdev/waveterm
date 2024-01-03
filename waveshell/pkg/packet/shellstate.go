// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package packet

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/waveshell/pkg/binpack"
	"github.com/wavetermdev/waveterm/waveshell/pkg/statediff"
	"golang.org/x/mod/semver"
)

const ShellStatePackVersion = 0
const ShellStateDiffPackVersion = 0

type ShellState struct {
	Version   string `json:"version"` // [type] [semver]
	Cwd       string `json:"cwd,omitempty"`
	ShellVars []byte `json:"shellvars,omitempty"`
	Aliases   string `json:"aliases,omitempty"`
	Funcs     string `json:"funcs,omitempty"`
	Error     string `json:"error,omitempty"`
	HashVal   string `json:"-"`
}

type ShellStateDiff struct {
	Version     string   `json:"version"` // [type] [semver]
	BaseHash    string   `json:"basehash"`
	DiffHashArr []string `json:"diffhasharr,omitempty"`
	Cwd         string   `json:"cwd,omitempty"`
	VarsDiff    []byte   `json:"shellvarsdiff,omitempty"` // vardiff
	AliasesDiff []byte   `json:"aliasesdiff,omitempty"`   // linediff
	FuncsDiff   []byte   `json:"funcsdiff,omitempty"`     // linediff
	Error       string   `json:"error,omitempty"`
	HashVal     string   `json:"-"`
}

func (state ShellState) GetShellType() string {
	if strings.HasPrefix(state.Version, "zsh") {
		return ShellType_zsh
	}
	return ShellType_bash
}

func (state ShellState) IsEmpty() bool {
	return state.Version == "" && state.Cwd == "" && len(state.ShellVars) == 0 && state.Aliases == "" && state.Funcs == "" && state.Error == ""
}

// returns base64 hash of data
func sha1Hash(data []byte) string {
	hvalRaw := sha1.Sum(data)
	hval := base64.StdEncoding.EncodeToString(hvalRaw[:])
	return hval
}

// returns (SHA1, encoded-state)
func (state ShellState) EncodeAndHash() (string, []byte) {
	var buf bytes.Buffer
	binpack.PackInt(&buf, ShellStatePackVersion)
	binpack.PackValue(&buf, []byte(state.Version))
	binpack.PackValue(&buf, []byte(state.Cwd))
	binpack.PackValue(&buf, state.ShellVars)
	binpack.PackValue(&buf, []byte(state.Aliases))
	binpack.PackValue(&buf, []byte(state.Funcs))
	binpack.PackValue(&buf, []byte(state.Error))
	return sha1Hash(buf.Bytes()), buf.Bytes()
}

// returns a string like "v4" ("" is an unparseable version)
func GetMajorVersion(versionStr string) string {
	if versionStr == "" {
		return ""
	}
	fields := strings.Split(versionStr, " ")
	if len(fields) < 2 {
		return ""
	}
	return semver.Major(fields[1])
}

func (state ShellState) MarshalJSON() ([]byte, error) {
	_, encodedBytes := state.EncodeAndHash()
	return json.Marshal(encodedBytes)
}

// caches HashVal in struct
func (state *ShellState) GetHashVal(force bool) string {
	if state.HashVal == "" || force {
		state.HashVal, _ = state.EncodeAndHash()
	}
	return state.HashVal
}

func (state *ShellState) DecodeShellState(barr []byte) error {
	state.HashVal = sha1Hash(barr)
	buf := bytes.NewBuffer(barr)
	u := binpack.MakeUnpacker(buf)
	version := u.UnpackInt("ShellState pack version")
	if version != ShellStatePackVersion {
		return fmt.Errorf("invalid ShellState pack version: %d", version)
	}
	state.Version = string(u.UnpackValue("ShellState.Version"))
	state.Cwd = string(u.UnpackValue("ShellState.Cwd"))
	state.ShellVars = u.UnpackValue("ShellState.ShellVars")
	state.Aliases = string(u.UnpackValue("ShellState.Aliases"))
	state.Funcs = string(u.UnpackValue("ShellState.Funcs"))
	state.Error = string(u.UnpackValue("ShellState.Error"))
	return u.Error()
}

func (state *ShellState) UnmarshalJSON(jsonBytes []byte) error {
	var barr []byte
	err := json.Unmarshal(jsonBytes, &barr)
	if err != nil {
		return err
	}
	return state.DecodeShellState(barr)
}

func (sdiff ShellStateDiff) EncodeAndHash() (string, []byte) {
	var buf bytes.Buffer
	binpack.PackInt(&buf, ShellStateDiffPackVersion)
	binpack.PackValue(&buf, []byte(sdiff.Version))
	binpack.PackValue(&buf, []byte(sdiff.BaseHash))
	binpack.PackStrArr(&buf, sdiff.DiffHashArr)
	binpack.PackValue(&buf, []byte(sdiff.Cwd))
	binpack.PackValue(&buf, sdiff.VarsDiff)
	binpack.PackValue(&buf, sdiff.AliasesDiff)
	binpack.PackValue(&buf, sdiff.FuncsDiff)
	binpack.PackValue(&buf, []byte(sdiff.Error))
	return sha1Hash(buf.Bytes()), buf.Bytes()
}

func (sdiff ShellStateDiff) MarshalJSON() ([]byte, error) {
	_, encodedBytes := sdiff.EncodeAndHash()
	return json.Marshal(encodedBytes)
}

func (sdiff *ShellStateDiff) DecodeShellStateDiff(barr []byte) error {
	sdiff.HashVal = sha1Hash(barr)
	buf := bytes.NewBuffer(barr)
	u := binpack.MakeUnpacker(buf)
	version := u.UnpackInt("ShellState pack version")
	if version != ShellStateDiffPackVersion {
		return fmt.Errorf("invalid ShellStateDiff pack version: %d", version)
	}
	sdiff.Version = string(u.UnpackValue("ShellStateDiff.Version"))
	sdiff.BaseHash = string(u.UnpackValue("ShellStateDiff.BaseHash"))
	sdiff.DiffHashArr = u.UnpackStrArr("ShellStateDiff.DiffHashArr")
	sdiff.Cwd = string(u.UnpackValue("ShellStateDiff.Cwd"))
	sdiff.VarsDiff = u.UnpackValue("ShellStateDiff.VarsDiff")
	sdiff.AliasesDiff = u.UnpackValue("ShellStateDiff.AliasesDiff")
	sdiff.FuncsDiff = u.UnpackValue("ShellStateDiff.FuncsDiff")
	sdiff.Error = string(u.UnpackValue("ShellStateDiff.Error"))
	return u.Error()
}

func (sdiff *ShellStateDiff) UnmarshalJSON(jsonBytes []byte) error {
	var barr []byte
	err := json.Unmarshal(jsonBytes, &barr)
	if err != nil {
		return err
	}
	return sdiff.DecodeShellStateDiff(barr)
}

// caches HashVal in struct
func (sdiff *ShellStateDiff) GetHashVal(force bool) string {
	if sdiff.HashVal == "" || force {
		sdiff.HashVal, _ = sdiff.EncodeAndHash()
	}
	return sdiff.HashVal
}

func (sdiff ShellStateDiff) Dump(vars bool, aliases bool, funcs bool) {
	fmt.Printf("ShellStateDiff:\n")
	fmt.Printf("  version: %s\n", sdiff.Version)
	fmt.Printf("  base: %s\n", sdiff.BaseHash)
	fmt.Printf("  vars: %d, aliases: %d, funcs: %d\n", len(sdiff.VarsDiff), len(sdiff.AliasesDiff), len(sdiff.FuncsDiff))
	if sdiff.Error != "" {
		fmt.Printf("  error: %s\n", sdiff.Error)
	}
	if vars {
		var mdiff statediff.MapDiffType
		err := mdiff.Decode(sdiff.VarsDiff)
		if err != nil {
			fmt.Printf("  vars: error[%s]\n", err.Error())
		} else {
			mdiff.Dump()
		}
	}
	if aliases && len(sdiff.AliasesDiff) > 0 {
		var ldiff statediff.LineDiffType
		err := ldiff.Decode(sdiff.AliasesDiff)
		if err != nil {
			fmt.Printf("  aliases: error[%s]\n", err.Error())
		} else {
			ldiff.Dump()
		}
	}
	if funcs && len(sdiff.FuncsDiff) > 0 {
		var ldiff statediff.LineDiffType
		err := ldiff.Decode(sdiff.FuncsDiff)
		if err != nil {
			fmt.Printf("  funcs: error[%s]\n", err.Error())
		} else {
			ldiff.Dump()
		}
	}
}
