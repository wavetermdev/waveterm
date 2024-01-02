// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shparse

import (
	"strings"

	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const (
	CompTypeCommandMeta = "command-meta"
	CompTypeCommand     = "command"
	CompTypeArg         = "command-arg"
	CompTypeInvalid     = "invalid"
	CompTypeVar         = "var"
	CompTypeAssignment  = "assignment"
	CompTypeBasic       = "basic"
)

type CompletionPos struct {
	RawPos      int // the raw position of cursor
	SuperOffset int // adjust all offsets in Cmd and CmdWord by SuperOffset

	CompType string   // see CompType* constants
	Cmd      *CmdType // nil if between commands or a special completion (otherwise will be a SimpleCommand)
	// index into cmd.Words (only set when Cmd is not nil, otherwise we look at CompCommand)
	//   0 means command-word
	//   negative means assignment-words.
	//   can be past the end of Words (means start new word).
	CmdWordPos     int
	CompWord       *WordType // set to the word we are completing (nil if we are starting a new word)
	CompWordOffset int       // offset into compword (only if CmdWord is not nil)
}

func compTypeFromPos(cmdWordPos int) string {
	if cmdWordPos == 0 {
		return CompTypeCommand
	}
	if cmdWordPos < 0 {
		return CompTypeAssignment
	}
	return CompTypeArg
}

func (cmd *CmdType) findCompletionPos_simple(pos int, superOffset int) CompletionPos {
	if cmd.Type != CmdTypeSimple {
		panic("findCompletetionPos_simple only works for CmdTypeSimple")
	}
	rtn := CompletionPos{RawPos: pos, SuperOffset: superOffset, Cmd: cmd}
	for idx, word := range cmd.AssignmentWords {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			// starting a new word at this position (before the current assignment word)
			rtn.CmdWordPos = idx - len(cmd.AssignmentWords)
			rtn.CompType = CompTypeAssignment
			return rtn
		}
		if pos <= endOffset {
			// completing an assignment word
			rtn.CmdWordPos = idx - len(cmd.AssignmentWords)
			rtn.CompWord = word
			rtn.CompWordOffset = pos - word.Offset
			rtn.CompType = CompTypeAssignment
			return rtn
		}
	}
	var foundWord *WordType
	var foundWordIdx int
	for idx, word := range cmd.Words {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			// starting a new word at this position
			rtn.CmdWordPos = idx
			rtn.CompType = compTypeFromPos(idx)
			return rtn
		}
		if pos == endOffset && word.Type == WordTypeOp {
			// operators are special, they can allow a full-word completion at endpos
			continue
		}
		if pos <= endOffset {
			foundWord = word
			foundWordIdx = idx
			break
		}
	}
	if foundWord != nil {
		rtn.CmdWordPos = foundWordIdx
		rtn.CompWord = foundWord
		rtn.CompWordOffset = pos - foundWord.Offset
		if foundWord.uncompletable() {
			// invalid completion point
			rtn.CompType = CompTypeInvalid
			return rtn
		}
		rtn.CompType = compTypeFromPos(foundWordIdx)
		return rtn
	}
	// past the end, so we're starting a new word in Cmd
	rtn.CmdWordPos = len(cmd.Words)
	rtn.CompType = CompTypeArg
	return rtn
}

func (cmd *CmdType) findCompletionPos_none(pos int, superOffset int) CompletionPos {
	rtn := CompletionPos{RawPos: pos, SuperOffset: superOffset}
	if cmd.Type != CmdTypeNone {
		panic("findCompletionPos_none only works for CmdTypeNone")
	}
	var foundWord *WordType
	for _, word := range cmd.Words {
		startOffset := word.Offset
		endOffset := word.Offset + len(word.Raw)
		if pos <= startOffset {
			break
		}
		if pos <= endOffset {
			if pos == endOffset && word.Type == WordTypeOp {
				// operators are special, they can allow a full-word completion at endpos
				continue
			}
			foundWord = word
			break
		}
	}
	if foundWord == nil {
		// just revert to a file completion
		rtn.CompType = CompTypeBasic
		return rtn
	}
	foundWordOffset := pos - foundWord.Offset
	rtn.CompWord = foundWord
	rtn.CompWordOffset = foundWordOffset
	if foundWord.uncompletable() {
		// ok, we're inside of a word in CmdTypeNone.  if we're in an uncompletable word, return CompInvalid
		rtn.CompType = CompTypeInvalid
		return rtn
	}
	if foundWordOffset > 0 && foundWordOffset < foundWord.contentStartPos() {
		// cursor is in a weird position, between characters of a multi-char prefix (e.g. "$[*]{hello}" or $[*]'hello').  cannot complete.
		rtn.CompType = CompTypeInvalid
		return rtn
	}
	// revert to file completion
	rtn.CompType = CompTypeBasic
	return rtn
}

func findCompletionWordAtPos(words []*WordType, pos int, allowEndMatch bool) *WordType {
	// WordTypeSimpleVar is special (always allowEndMatch), if cursor is at the end of SimpleVar it is returned
	for _, word := range words {
		if pos > word.Offset && pos < word.Offset+len(word.Raw) {
			return word
		}
		if (allowEndMatch || word.Type == WordTypeSimpleVar) && pos == word.Offset+len(word.Raw) {
			return word
		}
	}
	return nil
}

// recursively descend down the word, parse commands and find a sub completion point if any.
// return nil if there is no sub completion point in this word
func findCompletionPosInWord(word *WordType, posInWord int, superOffset int) *CompletionPos {
	rawPos := word.Offset + posInWord
	if word.Type == WordTypeGroup || word.Type == WordTypeDQ || word.Type == WordTypeDDQ {
		// need to descend further
		if posInWord <= word.contentStartPos() {
			return nil
		}
		if posInWord > word.contentEndPos() {
			return nil
		}
		subWord := findCompletionWordAtPos(word.Subs, posInWord-word.contentStartPos(), false)
		if subWord == nil {
			return nil
		}
		return findCompletionPosInWord(subWord, posInWord-(subWord.Offset+word.contentStartPos()), superOffset+(word.Offset+word.contentStartPos()))
	}
	if word.Type == WordTypeDP || word.Type == WordTypeBQ {
		if posInWord < word.contentStartPos() {
			return nil
		}
		if posInWord > word.contentEndPos() {
			return nil
		}
		subCmds := ParseCommands(word.Subs)
		newPos := findCompletionPosInternal(subCmds, posInWord-word.contentStartPos(), superOffset+(word.Offset+word.contentStartPos()))
		return &newPos
	}
	if word.Type == WordTypeSimpleVar || word.Type == WordTypeVarBrace {
		// special "var" completion
		rtn := &CompletionPos{RawPos: rawPos, SuperOffset: superOffset}
		rtn.CompType = CompTypeVar
		rtn.CompWordOffset = posInWord
		rtn.CompWord = word
		return rtn
	}
	return nil
}

// returns the context for completion
// if we are completing in a simple-command, the returns the Cmd.  the Cmd can be used for specialized completion (command name, arg position, etc.)
// if we are completing in a word, returns the Word.  Word might be a group-word or DQ word, so it may need additional resolution (done in extend)
// otherwise we are going to create a new word to insert at offset (so the context does not matter)
func findCompletionPosCmds(cmds []*CmdType, pos int, superOffset int) CompletionPos {
	rtn := CompletionPos{RawPos: pos, SuperOffset: superOffset}
	if len(cmds) == 0 {
		// set CompCommand because we're starting a new command
		rtn.CompType = CompTypeCommand
		return rtn
	}
	for _, cmd := range cmds {
		endOffset := cmd.endOffset()
		if pos > endOffset || (cmd.Type == CmdTypeNone && pos == endOffset) {
			continue
		}
		startOffset := cmd.offset()
		if cmd.Type == CmdTypeSimple {
			if pos <= startOffset {
				rtn.CompType = CompTypeCommand
				return rtn
			}
			return cmd.findCompletionPos_simple(pos, superOffset)
		} else {
			// not in a simple-command
			// if we're before the none-command, just start a new command
			if pos <= startOffset {
				rtn.CompType = CompTypeCommand
				return rtn
			}
			return cmd.findCompletionPos_none(pos, superOffset)
		}
	}
	// past the end
	lastCmd := cmds[len(cmds)-1]
	if lastCmd.Type == CmdTypeSimple {
		// just extend last command
		rtn.Cmd = lastCmd
		rtn.CmdWordPos = len(lastCmd.Words)
		rtn.CompType = CompTypeArg
		return rtn
	}
	// use lastCmd.NoneComplete to see if last command ended on a "separator".  use that to set CompCommand
	if lastCmd.NoneComplete {
		rtn.CompType = CompTypeCommand
	} else {
		rtn.CompType = CompTypeBasic
	}
	return rtn
}

func findCompletionPosInternal(cmds []*CmdType, pos int, superOffset int) CompletionPos {
	cpos := findCompletionPosCmds(cmds, pos, superOffset)
	if cpos.CompWord == nil {
		return cpos
	}
	subPos := findCompletionPosInWord(cpos.CompWord, cpos.CompWordOffset, superOffset)
	if subPos != nil {
		return *subPos
	}
	return cpos
}

func FindCompletionPos(cmds []*CmdType, pos int) CompletionPos {
	cpos := findCompletionPosInternal(cmds, pos, 0)
	if cpos.CompType == CompTypeCommand && cpos.SuperOffset == 0 && cpos.CompWord != nil && cpos.CompWord.Offset == 0 && strings.HasPrefix(string(cpos.CompWord.Raw), "/") {
		cpos.CompType = CompTypeCommandMeta
	}
	return cpos
}

func (cpos CompletionPos) Extend(origStr utilfn.StrWithPos, extensionStr string, extensionComplete bool) utilfn.StrWithPos {
	compWord := cpos.CompWord
	if compWord == nil {
		compWord = MakeEmptyWord(WordTypeLit, nil, cpos.RawPos, true)
	}
	realOffset := compWord.Offset + cpos.SuperOffset
	if strings.HasSuffix(extensionStr, "/") {
		extensionComplete = false
	}
	rtnSP := Extend(compWord, cpos.CompWordOffset, extensionStr, extensionComplete)
	origRunes := []rune(origStr.Str)
	rtnSP = rtnSP.Prepend(string(origRunes[0:realOffset]))
	rtnSP = rtnSP.Append(string(origRunes[realOffset+len(compWord.Raw):]))
	return rtnSP
}
