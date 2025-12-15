//go:build !windows

package remote

import "net"

// dialIdentityAgent connects to a Unix domain socket identity agent.
func dialIdentityAgent(agentPath string) (net.Conn, error) {
	return net.Dial("unix", agentPath)
}
