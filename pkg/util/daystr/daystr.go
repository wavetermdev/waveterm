// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package daystr

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

var customDayStrRe = regexp.MustCompile(`^((?:\d{4}-\d{2}-\d{2})|today|yesterday|bom|bow)?((?:[+-]\d+[dwm])*)$`)
var daystrRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

func GetCurDayStr() string {
	now := time.Now()
	dayStr := now.Format("2006-01-02")
	return dayStr
}

func GetRelDayStr(relDays int) string {
	now := time.Now()
	dayStr := now.AddDate(0, 0, relDays).Format("2006-01-02")
	return dayStr
}

// accepts a custom format string to return a daystr
// can be either a prefix, a delta, or a prefix w/ a delta
// if no prefix is given, "today" is assumed
// examples: today-2d, bow, bom+1m-1d (that's end of the month), 2025-04-01+1w
//
// prefixes:
//
//	yyyy-mm-dd
//	today
//	yesterday
//	bom (beginning of month)
//	bow (beginning of week -- sunday)
//
// deltas:
//
//	+[n]d, -[n]d (e.g. +1d, -5d)
//	+[n]w, -[n]w (e.g. +2w)
//	+[n]m, -[n]m (e.g. -1m)
//	deltas can be combined e.g. +1w-2d
func GetCustomDayStr(format string) (string, error) {
	m := customDayStrRe.FindStringSubmatch(format)
	if m == nil {
		return "", fmt.Errorf("invalid daystr format")
	}
	prefix, deltas := m[1], m[2]
	if prefix == "" {
		prefix = "today"
	}
	var rtnTime time.Time
	now := time.Now()
	switch prefix {
	case "today":
		rtnTime = now
	case "yesterday":
		rtnTime = now.AddDate(0, 0, -1)
	case "bom":
		rtnTime = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	case "bow":
		weekday := now.Weekday()
		if weekday == time.Sunday {
			rtnTime = now
		} else {
			rtnTime = now.AddDate(0, 0, -int(weekday))
		}
	default:
		m = daystrRe.FindStringSubmatch(prefix)
		if m == nil {
			return "", fmt.Errorf("invalid prefix format")
		}
		year, month, day := m[1], m[2], m[3]
		yearInt, monthInt, dayInt := utilfn.AtoiNoErr(year), utilfn.AtoiNoErr(month), utilfn.AtoiNoErr(day)
		if yearInt == 0 || monthInt == 0 || dayInt == 0 {
			return "", fmt.Errorf("invalid prefix format")
		}
		rtnTime = time.Date(yearInt, time.Month(monthInt), dayInt, 0, 0, 0, 0, now.Location())
	}
	for _, delta := range regexp.MustCompile(`[+-]\d+[dwm]`).FindAllString(deltas, -1) {
		deltaVal, err := strconv.Atoi(delta[1 : len(delta)-1])
		if err != nil {
			return "", fmt.Errorf("invalid delta format")
		}
		if delta[0] == '-' {
			deltaVal = -deltaVal
		}
		switch delta[len(delta)-1] {
		case 'd':
			rtnTime = rtnTime.AddDate(0, 0, deltaVal)
		case 'w':
			rtnTime = rtnTime.AddDate(0, 0, deltaVal*7)
		case 'm':
			rtnTime = rtnTime.AddDate(0, deltaVal, 0)
		}
	}
	return rtnTime.Format("2006-01-02"), nil
}
