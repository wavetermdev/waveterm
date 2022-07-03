package scpacket

import (
	"reflect"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const FeCommandPacketStr = "fecmd"

type RemoteState struct {
	RemoteId   string `json:"remoteid"`
	RemoteName string `json:"remotename"`
	Cwd        string `json:"cwd"`
}

type FeCommandPacketType struct {
	Type        string      `json:"type"`
	SessionId   string      `json:"sessionid"`
	WindowId    string      `json:"windowid"`
	UserId      string      `json:"userid"`
	CmdStr      string      `json:"cmdstr"`
	RemoteState RemoteState `json:"remotestate"`
}

func init() {
	packet.RegisterPacketType(FeCommandPacketStr, reflect.TypeOf(&FeCommandPacketType{}))
}

func (*FeCommandPacketType) GetType() string {
	return FeCommandPacketStr
}

func MakeFeCommandPacket() *FeCommandPacketType {
	return &FeCommandPacketType{Type: FeCommandPacketStr}
}
