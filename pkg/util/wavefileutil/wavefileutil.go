package wavefileutil

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	WaveFilePathPattern = "wavefile://%s/%s"
)

func WaveFileToFileInfo(wf *filestore.WaveFile) *wshrpc.FileInfo {
	path := fmt.Sprintf(WaveFilePathPattern, wf.ZoneId, wf.Name)
	return &wshrpc.FileInfo{
		Path:          path,
		Name:          wf.Name,
		Opts:          &wf.Opts,
		Size:          wf.Size,
		Meta:          &wf.Meta,
		SupportsMkdir: false,
	}
}

func WaveFileListToFileInfoList(wfList []*filestore.WaveFile) []*wshrpc.FileInfo {
	var fileInfoList []*wshrpc.FileInfo
	for _, wf := range wfList {
		fileInfoList = append(fileInfoList, WaveFileToFileInfo(wf))
	}
	return fileInfoList
}
