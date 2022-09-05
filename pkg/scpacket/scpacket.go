package scpacket

import (
	"reflect"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const FeCommandPacketStr = "fecmd"
const WatchScreenPacketStr = "watchscreen"
const FeInputPacketStr = "feinput"

type FeCommandPacketType struct {
	Type        string            `json:"type"`
	MetaCmd     string            `json:"metacmd"`
	MetaSubCmd  string            `json:"metasubcmd,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Kwargs      map[string]string `json:"kwargs,omitempty"`
	UIContext   *UIContextType    `json:"uicontext,omitempty"`
	Interactive bool              `json:"interactive"`
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
	InputData64 string               `json:"inputdata"`
	SigNum      int                  `json:"signum,omitempty"`
	WinSizeRows int                  `json:"winsizerows"`
	WinSizeCols int                  `json:"winsizecols"`
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

func (p *FeInputPacketType) ConvertToInputPacket() *packet.InputPacketType {
	rtn := packet.MakeInputPacket()
	rtn.CK = p.CK
	rtn.RemoteId = p.Remote.RemoteId
	rtn.InputData64 = p.InputData64
	rtn.SigNum = p.SigNum
	rtn.WinSizeRows = p.WinSizeRows
	rtn.WinSizeCols = p.WinSizeCols
	return rtn
}

func (*WatchScreenPacketType) GetType() string {
	return WatchScreenPacketStr
}

func MakeWatchScreenPacket() *WatchScreenPacketType {
	return &WatchScreenPacketType{Type: WatchScreenPacketStr}
}
