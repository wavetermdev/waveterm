package wshremote

import (
	"io/fs"
	"testing"
	"time"
)

type fakeFileInfo struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime time.Time
	isDir   bool
}

func (f fakeFileInfo) Name() string       { return f.name }
func (f fakeFileInfo) Size() int64        { return f.size }
func (f fakeFileInfo) Mode() fs.FileMode  { return f.mode }
func (f fakeFileInfo) ModTime() time.Time { return f.modTime }
func (f fakeFileInfo) IsDir() bool        { return f.isDir }
func (f fakeFileInfo) Sys() any           { return nil }

func TestIsWindowsVirtualRoot(t *testing.T) {
	if !isWindowsVirtualRoot(`\`, "windows") {
		t.Fatalf("expected windows virtual root to match backslash")
	}
	if !isWindowsVirtualRoot(`/`, "windows") {
		t.Fatalf("expected windows virtual root to match slash")
	}
	if isWindowsVirtualRoot(`C:\`, "windows") {
		t.Fatalf("drive root should not be treated as virtual root")
	}
	if isWindowsVirtualRoot(`/`, "linux") {
		t.Fatalf("non-windows path should not be treated as windows virtual root")
	}
}

func TestIsWindowsDriveRoot(t *testing.T) {
	if !isWindowsDriveRoot(`C:\`, "windows") {
		t.Fatalf("expected drive root to match")
	}
	if isWindowsDriveRoot(`C:\Users`, "windows") {
		t.Fatalf("non-root drive path should not match")
	}
	if isWindowsDriveRoot(`C:\`, "linux") {
		t.Fatalf("non-windows OS should not match windows drive roots")
	}
}

func TestListWindowsDriveInfos(t *testing.T) {
	seen := map[string]bool{}
	statFn := func(path string) (fs.FileInfo, error) {
		seen[path] = true
		switch path {
		case `C:\`, `D:\`:
			return fakeFileInfo{
				name:    path,
				mode:    fs.ModeDir | 0755,
				modTime: time.UnixMilli(1234),
				isDir:   true,
			}, nil
		default:
			return nil, fs.ErrNotExist
		}
	}

	infos := listWindowsDriveInfos("windows", statFn)
	if len(infos) != 2 {
		t.Fatalf("expected 2 drives, got %d", len(infos))
	}
	if infos[0].Path != `C:\` || infos[0].Dir != "/" || infos[0].Name != `C:\` {
		t.Fatalf("unexpected first drive info: %#v", infos[0])
	}
	if infos[1].Path != `D:\` || infos[1].Dir != "/" || infos[1].Name != `D:\` {
		t.Fatalf("unexpected second drive info: %#v", infos[1])
	}
	if !seen[`C:\`] || !seen[`D:\`] {
		t.Fatalf("expected statFn to probe C and D drives: %#v", seen)
	}
}
