// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// implements distributed logging for waveshell processes
package wlog

import (
	"fmt"
	"log"
)

// wlog will send logs back to the controlling wavesrv process
// note that these logs end up on your local machine where the main Wave Terminal process is running
// wlog has no ability to send logs to a cloud service or Command Line Inc servers

// this code is written a bit strange (with globals getting set from other packages)
// because we want no dependencies so any package (including base) can use wlog

// this should match base.ProcessType (set by main)
var GlobalSubsystem string

// if not set, Logf is a no-op.  will be set by main to hook up to
// the main packet.PacketSender
var LogConsumer func(LogEntry)

type LogEntry struct {
	LogLine   string `json:"logline"`
	ReqId     string `json:"reqid"`
	SubSystem string `json:"subsystem"`
}

func LogLogEntry(entry LogEntry) {
	if LogConsumer == nil {
		return
	}
	LogConsumer(entry)
}

// log with a request id (if related to an rpc request)
func LogfRpc(reqId string, format string, args ...interface{}) {
	if LogConsumer == nil {
		return
	}
	logEntry := LogEntry{
		LogLine:   fmt.Sprintf(format, args...),
		ReqId:     reqId,
		SubSystem: GlobalSubsystem,
	}
	LogConsumer(logEntry)
}

func LogfSS(subsystem string, format string, args ...interface{}) {
	if LogConsumer == nil {
		return
	}
	logEntry := LogEntry{
		LogLine:   fmt.Sprintf(format, args...),
		ReqId:     "",
		SubSystem: subsystem,
	}
	LogConsumer(logEntry)
}

func Logf(format string, args ...interface{}) {
	LogfSS(GlobalSubsystem, format, args...)
}

func LogWithLogger(entry LogEntry) {
	if entry.SubSystem == "" {
		entry.SubSystem = "unknown"
	}
	if entry.ReqId != "" {
		log.Printf("[%s] reqid=%s %s", entry.SubSystem, entry.ReqId, entry.LogLine)
	} else {
		log.Printf("[%s] %s", entry.SubSystem, entry.LogLine)
	}
}
