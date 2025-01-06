package prefuser

/*
GUIName: for yaml and alternative db id, mostly for electron
*/
type prefItem struct {
	Name    string            `json:"name"`
	GUIName string            `json:"guiname"`
	Config  map[string]string `json:"config"`
}
