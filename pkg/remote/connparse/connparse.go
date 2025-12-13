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
	ConnectionTypeWsh  = "wsh"
	ConnectionTypeS3   = "s3"
	ConnectionTypeWave = "wavefile"

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

// It recognizes explicit schemes (scheme://...), shorthand forms starting with "//host/path" and WSL-style URIs (wsl://distro/path). When no scheme is provided the scheme defaults to "wsh" and the host may be set to the current connection marker or to the local connection name for local shorthand. For the "wsh" scheme: missing host defaults to the local connection name; paths beginning with "/~" are normalized by removing the leading slash; other paths may receive a prepended "/" except when they look like Windows drive paths, start with ".", "~", or already start with a slash. Trailing slashes in the original URI are preserved in the parsed Path.
func ParseURI(uri string) (*Connection, error) {
	var scheme string
	var rest string

	if strings.HasPrefix(uri, "//") {
		rest = strings.TrimPrefix(uri, "//")
	} else {
		split := strings.SplitN(uri, "://", 2)
		if len(split) > 1 {
			scheme = split[0]
			rest = strings.TrimPrefix(split[1], "//")
		} else {
			rest = split[0]
		}
	}

	var host string
	var remotePath string

	parseGenericPath := func() {
		parts := strings.SplitN(rest, "/", 2)
		host = parts[0]
		if len(parts) > 1 && parts[1] != "" {
			remotePath = parts[1]
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
		if strings.HasPrefix(uri, "//") {
			rest = strings.TrimPrefix(uri, "//")
			// Handles remote shorthand like //host/path and WSL URIs //wsl://distro/path
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