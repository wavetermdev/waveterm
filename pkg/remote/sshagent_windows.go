//go:build windows

package remote

import (
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

// dialIdentityAgent connects to the Windows OpenSSH agent named pipe.
func dialIdentityAgent(agentPath string) (net.Conn, error) {
	timeout := 500 * time.Millisecond
	return winio.DialPipe(agentPath, &timeout)
}
