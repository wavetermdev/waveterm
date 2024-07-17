// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

type WaveAppStyle struct {
	BackgroundColor string `json:"backgroundColor,omitempty"`
	Color           string `json:"color,omitempty"`
	Border          string `json:"border,omitempty"`
	FontSize        string `json:"fontSize,omitempty"`
	FontFamily      string `json:"fontFamily,omitempty"`
	FontWeight      string `json:"fontWeight,omitempty"`
	FontStyle       string `json:"fontStyle,omitempty"`
	TextDecoration  string `json:"textDecoration,omitempty"`
}

type WaveAppMouseEvent struct {
	TargetId string `json:"targetid"`
}

type WaveAppChangeEvent struct {
	TargetId string `json:"targetid"`
	Value    string `json:"value"`
}

type WaveAppElement struct {
	WaveId   string            `json:"waveid"`
	Elem     string            `json:"elem"`
	Props    map[string]any    `json:"props,omitempty"`
	Handlers map[string]string `json:"handlers,omitempty"`
	Children []*WaveAppElement `json:"children,omitempty"`
}

func (e *WaveAppElement) AddChild(child *WaveAppElement) {
	e.Children = append(e.Children, child)
}

func (e *WaveAppElement) Style() *WaveAppStyle {
	style, ok := e.Props["style"].(*WaveAppStyle)
	if !ok {
		style := &WaveAppStyle{}
		e.Props["style"] = style
	}
	return style
}

func main() {

}
