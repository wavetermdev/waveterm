//go:build windows

package remote

import (
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

// dialIdentityAgent connects to the Windows OpenSSH agent named pipe at the given path and returns the established connection or an error.
func dialIdentityAgent(agentPath string) (net.Conn, error) {
	timeout := 2 * time.Second
	return winio.DialPipe(agentPath, &timeout)
}