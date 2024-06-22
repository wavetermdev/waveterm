// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"fmt"
)

type DateTimeStyle uint8

const (
	DateTimeStyleFull = iota + 1
	DateTimeStyleLong
	DateTimeStyleMedium
	DateTimeStyleShort
)

var dateTimeStyleToString = map[uint8]string{
	1: "full",
	2: "long",
	3: "medium",
	4: "short",
}

var stringToDateTimeStyle = map[string]uint8{
	"full":   1,
	"long":   2,
	"medium": 3,
	"short":  4,
}

func (dts DateTimeStyle) String() string {
	return dateTimeStyleToString[uint8(dts)]
}

func parseDateTimeStyle(input string) (DateTimeStyle, error) {
	value, ok := stringToDateTimeStyle[input]
	if !ok {
		return DateTimeStyle(0), fmt.Errorf("%q is not a valid date-time style", input)
	}
	return DateTimeStyle(value), nil
}

func (dts DateTimeStyle) MarshalJSON() ([]byte, error) {
	return json.Marshal(dts.String())
}

func (dts *DateTimeStyle) UnmarshalJSON(data []byte) (err error) {
	var buffer string
	if err := json.Unmarshal(data, &buffer); err != nil {
		return err
	}
	if *dts, err = parseDateTimeStyle(buffer); err != nil {
		return err
	}
	return nil
}
