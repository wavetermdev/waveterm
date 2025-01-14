// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package connparse

import (
	"os"
	"strings"
)

const (
	ConnectionTypeWsh  = "wsh"
	ConnectionTypeS3   = "s3"
	ConnectionTypeWave = "wavefile"
)

type Connection struct {
	Scheme string
	Host   string
	Path   string
}

func (c *Connection) GetSchemeParts() []string {
	return strings.Split(c.Scheme, ":")
}

func (c *Connection) GetType() string {
	lastInd := strings.LastIndex(c.Scheme, ":")
	if lastInd == -1 {
		return c.Scheme
	}
	return c.Scheme[lastInd+1:]
}

func (c *Connection) GetPathWithHost() string {
	if c.Host == "" {
		return ""
	}
	if strings.HasPrefix(c.Path, "/") {
		return c.Host + c.Path
	}
	return c.Host + "/" + c.Path
}

func (c *Connection) GetFullURI() string {
	return c.Scheme + "://" + c.GetPathWithHost()
}

// ParseURI parses a connection URI and returns the connection type, host/path, and parameters.
func ParseURI(uri string) (*Connection, error) {
	split := strings.SplitN(uri, "://", 2)
	var scheme string
	var rest string
	if len(split) > 1 {
		scheme = split[0]
		rest = split[1]
	} else {
		rest = split[0]
	}
	if scheme == "" {
		scheme = "wsh"
	}

	var host string
	var path string
	if strings.HasPrefix(rest, "//") {
		rest = strings.TrimPrefix(rest, "//")
		split = strings.SplitN(rest, "/", 2)
		if len(split) > 1 {
			host = split[0]
			path = "/" + split[1]
		} else {
			host = split[0]
			path = "/"
		}
	} else if strings.HasPrefix(rest, "/~") {
		host = "local"
		path = strings.TrimPrefix(rest, "/")
	} else if stat, _ := os.Stat(rest); stat != nil {
		host = "current"
		path = rest
	} else {
		split = strings.SplitN(rest, "/", 2)
		if len(split) > 1 {
			host = split[0]
			path = "/" + split[1]
		} else {
			host = split[0]
			path = "/"
		}
	}

	return &Connection{
		Scheme: scheme,
		Host:   host,
		Path:   path,
	}, nil
}
