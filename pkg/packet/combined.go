package packet

type CombinedPacket struct {
	Type    string `json:"type"`
	Success bool   `json:"success"`
	Ts      int64  `json:"ts"`
	Id      string `json:"id,omitempty"`

	SessionId string `json:"sessionid"`
	CmdId     string `json:"cmdid"`

	PtyPos int64 `json:"ptypos"`
	PtyLen int64 `json:"ptylen"`
	RunPos int64 `json:"runpos"`
	RunLen int64 `json:"runlen"`

	Error    string `json:"error"`
	NotFound bool   `json:"notfound,omitempty"`
	Tail     bool   `json:"tail,omitempty"`
	Dir      string `json:"dir"`
	ChDir    string `json:"chdir,omitempty"`

	Data    string `json:"data"`
	PtyData string `json:"ptydata"`
	RunData string `json:"rundata"`
	Message string `json:"message"`
	Command string `json:"command"`

	ScHomeDir string   `json:"schomedir"`
	HomeDir   string   `json:"homedir"`
	Env       []string `json:"env"`
	ExitCode  int      `json:"exitcode"`
	RunnerPid int      `json:"runnerpid"`
}
