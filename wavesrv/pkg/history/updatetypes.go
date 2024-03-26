package history

type HistoryInfoType struct {
	HistoryType string             `json:"historytype"`
	SessionId   string             `json:"sessionid,omitempty"`
	ScreenId    string             `json:"screenid,omitempty"`
	Items       []*HistoryItemType `json:"items"`
	Show        bool               `json:"show"`
}

func (HistoryInfoType) GetType() string {
	return "history"
}
