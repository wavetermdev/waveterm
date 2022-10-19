package scpacket

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const FeCommandPacketStr = "fecmd"
const WatchScreenPacketStr = "watchscreen"
const FeInputPacketStr = "feinput"
const RemoteInputPacketStr = "remoteinput"

type FeCommandPacketType struct {
	Type        string            `json:"type"`
	MetaCmd     string            `json:"metacmd"`
	MetaSubCmd  string            `json:"metasubcmd,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Kwargs      map[string]string `json:"kwargs,omitempty"`
	RawStr      string            `json:"rawstr,omitempty"`
	UIContext   *UIContextType    `json:"uicontext,omitempty"`
	Interactive bool              `json:"interactive"`
}

func (pk *FeCommandPacketType) GetRawStr() string {
	if pk.RawStr != "" {
		return pk.RawStr
	}
	cmd := "/" + pk.MetaCmd
	if pk.MetaSubCmd != "" {
		cmd = cmd + ":" + pk.MetaSubCmd
	}
	var args []string
	for k, v := range pk.Kwargs {
		argStr := fmt.Sprintf("%s=%s", shellescape.Quote(k), shellescape.Quote(v))
		args = append(args, argStr)
	}
	for _, arg := range pk.Args {
		args = append(args, shellescape.Quote(arg))
	}
	if len(args) == 0 {
		return cmd
	}
	return cmd + " " + strings.Join(args, " ")
}

type UIContextType struct {
	SessionId string                `json:"sessionid"`
	ScreenId  string                `json:"screenid"`
	WindowId  string                `json:"windowid"`
	Remote    *sstore.RemotePtrType `json:"remote,omitempty"`
	TermOpts  *packet.TermOpts      `json:"termopts,omitempty"`
}

type FeInputPacketType struct {
	Type        string               `json:"type"`
	CK          base.CommandKey      `json:"ck"`
	Remote      sstore.RemotePtrType `json:"remote"`
	InputData64 string               `json:"inputdata64"`
	SigName     string               `json:"signame,omitempty"`
	WinSize     *packet.WinSize      `json:"winsize,omitempty"`
}

type RemoteInputPacketType struct {
	Type        string `json:"type"`
	RemoteId    string `json:"remoteid"`
	InputData64 string `json:"inputdata64"`
}

type WatchScreenPacketType struct {
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
	ScreenId  string `json:"screenid"`
	Connect   bool   `json:"connect"`
}

func init() {
	packet.RegisterPacketType(FeCommandPacketStr, reflect.TypeOf(FeCommandPacketType{}))
	packet.RegisterPacketType(WatchScreenPacketStr, reflect.TypeOf(WatchScreenPacketType{}))
	packet.RegisterPacketType(FeInputPacketStr, reflect.TypeOf(FeInputPacketType{}))
	packet.RegisterPacketType(RemoteInputPacketStr, reflect.TypeOf(RemoteInputPacketType{}))
}

func (*FeCommandPacketType) GetType() string {
	return FeCommandPacketStr
}

func MakeFeCommandPacket() *FeCommandPacketType {
	return &FeCommandPacketType{Type: FeCommandPacketStr}
}

func (*FeInputPacketType) GetType() string {
	return FeInputPacketStr
}

func MakeFeInputPacket() *FeInputPacketType {
	return &FeInputPacketType{Type: FeInputPacketStr}
}

func (*WatchScreenPacketType) GetType() string {
	return WatchScreenPacketStr
}

func MakeWatchScreenPacket() *WatchScreenPacketType {
	return &WatchScreenPacketType{Type: WatchScreenPacketStr}
}

func MakeRemoteInputPacket() *RemoteInputPacketType {
	return &RemoteInputPacketType{Type: RemoteInputPacketStr}
}

func (*RemoteInputPacketType) GetType() string {
	return RemoteInputPacketStr
}
