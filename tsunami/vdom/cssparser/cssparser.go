// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cssparser

import (
	"fmt"
	"strings"
	"unicode"
)

type Parser struct {
	Input      string
	Pos        int
	Length     int
	InQuote    bool
	QuoteChar  rune
	OpenParens int
	Debug      bool
}

func MakeParser(input string) *Parser {
	return &Parser{
		Input:  input,
		Length: len(input),
	}
}

func (p *Parser) Parse() (map[string]string, error) {
	result := make(map[string]string)
	lastProp := ""
	for {
		p.skipWhitespace()
		if p.eof() {
			break
		}
		propName, err := p.parseIdentifierColon(lastProp)
		if err != nil {
			return nil, err
		}
		lastProp = propName
		p.skipWhitespace()
		value, err := p.parseValue(propName)
		if err != nil {
			return nil, err
		}
		result[propName] = value
		p.skipWhitespace()
		if p.eof() {
			break
		}
		if !p.expectChar(';') {
			break
		}
	}
	p.skipWhitespace()
	if !p.eof() {
		return nil, fmt.Errorf("bad style attribute, unexpected character %q at pos %d", string(p.Input[p.Pos]), p.Pos+1)
	}
	return result, nil
}

func (p *Parser) parseIdentifierColon(lastProp string) (string, error) {
	start := p.Pos
	for !p.eof() {
		c := p.peekChar()
		if isIdentChar(c) || c == '-' {
			p.advance()
		} else {
			break
		}
	}
	attrName := p.Input[start:p.Pos]
	p.skipWhitespace()
	if p.eof() {
		return "", fmt.Errorf("bad style attribute, expected colon after property %q, got EOF, at pos %d", attrName, p.Pos+1)
	}
	if attrName == "" {
		return "", fmt.Errorf("bad style attribute, invalid property name after property %q, at pos %d", lastProp, p.Pos+1)
	}
	if !p.expectChar(':') {
		return "", fmt.Errorf("bad style attribute, bad property name starting with %q, expected colon, got %q, at pos %d", attrName, string(p.Input[p.Pos]), p.Pos+1)
	}
	return attrName, nil
}

func (p *Parser) parseValue(propName string) (string, error) {
	start := p.Pos
	quotePos := 0
	parenPosStack := make([]int, 0)
	for !p.eof() {
		c := p.peekChar()
		if p.InQuote {
			if c == p.QuoteChar {
				p.InQuote = false
			} else if c == '\\' {
				p.advance()
			}
		} else {
			if c == '"' || c == '\'' {
				p.InQuote = true
				p.QuoteChar = c
				quotePos = p.Pos
			} else if c == '(' {
				p.OpenParens++
				parenPosStack = append(parenPosStack, p.Pos)
			} else if c == ')' {
				if p.OpenParens == 0 {
					return "", fmt.Errorf("unmatched ')' at pos %d", p.Pos+1)
				}
				p.OpenParens--
				parenPosStack = parenPosStack[:len(parenPosStack)-1]
			} else if c == ';' && p.OpenParens == 0 {
				break
			}
		}
		p.advance()
	}
	if p.eof() && p.InQuote {
		return "", fmt.Errorf("bad style attribute, while parsing attribute %q, unmatched quote at pos %d", propName, quotePos+1)
	}
	if p.eof() && p.OpenParens > 0 {
		return "", fmt.Errorf("bad style attribute, while parsing property %q, unmatched '(' at pos %d", propName, parenPosStack[len(parenPosStack)-1]+1)
	}
	return strings.TrimSpace(p.Input[start:p.Pos]), nil
}

func isIdentChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

func (p *Parser) skipWhitespace() {
	for !p.eof() && unicode.IsSpace(p.peekChar()) {
		p.advance()
	}
}

func (p *Parser) expectChar(expected rune) bool {
	if !p.eof() && p.peekChar() == expected {
		p.advance()
		return true
	}
	return false
}

func (p *Parser) peekChar() rune {
	if p.Pos >= p.Length {
		return 0
	}
	return rune(p.Input[p.Pos])
}

func (p *Parser) advance() {
	p.Pos++
}

func (p *Parser) eof() bool {
	return p.Pos >= p.Length
}