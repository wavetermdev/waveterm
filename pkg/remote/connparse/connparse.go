// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package connparse

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	ConnectionTypeWsh = "wsh"

	ConnHostCurrent = "current"
	ConnHostWaveSrv = "wavesrv"
)

var windowsDriveRegex = regexp.MustCompile(`^[a-zA-Z]:`)
var wslConnRegex = regexp.MustCompile(`^wsl://[^/]+`)

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
	if c.Path == "" {
		return c.Host
	}
	if strings.HasPrefix(c.Path, "/") {
		return c.Host + c.Path
	}
	return c.Host + "/" + c.Path
}

func (c *Connection) GetFullURI() string {
	return c.Scheme + "://" + c.GetPathWithHost()
}

func (c *Connection) GetSchemeAndHost() string {
	return c.Scheme + "://" + c.Host
}

func ParseURIAndReplaceCurrentHost(ctx context.Context, uri string) (*Connection, error) {
	conn, err := ParseURI(uri)
	if err != nil {
		return nil, fmt.Errorf("error parsing connection: %v", err)
	}
	if conn.Host == ConnHostCurrent {
		source, err := GetConnNameFromContext(ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting connection name from context: %v", err)
		}

		// RPC context connection is empty for local connections
		if source == "" {
			source = wshrpc.LocalConnName
		}
		conn.Host = source
	}
	return conn, nil
}

func GetConnNameFromContext(ctx context.Context) (string, error) {
	handler := wshutil.GetRpcResponseHandlerFromContext(ctx)
	if handler == nil {
		return "", fmt.Errorf("error getting rpc response handler from context")
	}
	return handler.GetRpcContext().Conn, nil
}

// ParseURI parses a connection URI and returns the connection type, host/path, and parameters.
func ParseURI(uri string) (*Connection, error) {
	split := strings.SplitN(uri, "://", 2)
	var scheme string
	var rest string
	if len(split) > 1 {
		scheme = split[0]
		rest = strings.TrimPrefix(split[1], "//")
	} else {
		rest = split[0]
	}

	var host string
	var remotePath string

	parseGenericPath := func() {
		split = strings.SplitN(rest, "/", 2)
		host = split[0]
		if len(split) > 1 && split[1] != "" {
			remotePath = split[1]
		} else if strings.HasSuffix(rest, "/") {
			// preserve trailing slash
			remotePath = "/"
		} else {
			remotePath = ""
		}
	}
	parseWshPath := func() {
		if strings.HasPrefix(rest, "wsl://") {
			host = wslConnRegex.FindString(rest)
			remotePath = strings.TrimPrefix(rest, host)
		} else {
			parseGenericPath()
		}
	}

	addPrecedingSlash := true

	if scheme == "" {
		scheme = ConnectionTypeWsh
		addPrecedingSlash = false
		if len(rest) != len(uri) {
			// This accounts for when the uri starts with "//", which would get trimmed in the first split.
			parseWshPath()
		} else if strings.HasPrefix(rest, "/~") {
			host = wshrpc.LocalConnName
			remotePath = rest
		} else {
			host = ConnHostCurrent
			remotePath = rest
		}
	} else if scheme == ConnectionTypeWsh {
		parseWshPath()
	} else {
		parseGenericPath()
	}

	if scheme == ConnectionTypeWsh {
		if host == "" {
			host = wshrpc.LocalConnName
		}
		if strings.HasPrefix(remotePath, "/~") {
			remotePath = strings.TrimPrefix(remotePath, "/")
		} else if addPrecedingSlash && (len(remotePath) > 1 && !windowsDriveRegex.MatchString(remotePath) && !strings.HasPrefix(remotePath, "/") && !strings.HasPrefix(remotePath, "~") && !strings.HasPrefix(remotePath, "./") && !strings.HasPrefix(remotePath, "../") && !strings.HasPrefix(remotePath, ".\\") && !strings.HasPrefix(remotePath, "..\\") && remotePath != "..") {
			remotePath = "/" + remotePath
		}
	}

	conn := &Connection{
		Scheme: scheme,
		Host:   host,
		Path:   remotePath,
	}
	return conn, nil
}
