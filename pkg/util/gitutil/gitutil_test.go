// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitutil

import (
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
}

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_CONFIG_SYSTEM="+os.DevNull,
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, out)
	}
}

func writeFile(t *testing.T, dir string, name string, contents string) {
	t.Helper()
	fullPath := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte(contents), 0644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, dir string, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func fileExists(dir string, name string) bool {
	_, err := os.Lstat(filepath.Join(dir, filepath.FromSlash(name)))
	return err == nil
}

func makeRepo(t *testing.T) string {
	t.Helper()
	requireGit(t)
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "init", "-q", "-b", "main")
	return dir
}

// makeMixedRepo commits a baseline then produces one change of each kind in the working tree
func makeMixedRepo(t *testing.T) string {
	t.Helper()
	dir := makeRepo(t)
	writeFile(t, dir, "mod.txt", "a\nb\n")
	writeFile(t, dir, "del.txt", "gone\n")
	writeFile(t, dir, "old.txt", "rename me\nline2\n")
	writeFile(t, dir, "sub/keep.txt", "keep\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "init")

	writeFile(t, dir, "mod.txt", "a\nB\nc\n")
	if err := os.Remove(filepath.Join(dir, "del.txt")); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "mv", "old.txt", "new name.txt")
	writeFile(t, dir, "added.txt", "new\n")
	gitCmd(t, dir, "add", "added.txt")
	writeFile(t, dir, "untracked ü.txt", "u1\nu2\nu3")
	return dir
}

func findFile(files []wshrpc.GitFileStatus, path string) *wshrpc.GitFileStatus {
	for i := range files {
		if files[i].Path == path {
			return &files[i]
		}
	}
	return nil
}

func TestParsePorcelainZ(t *testing.T) {
	out := []byte("A  added.txt\x00 D d.txt\x00 M m.txt\x00R  new name.txt\x00old.txt\x00?? untr ü.txt\x00UU conflict.txt\x00MM both.txt\x00")
	entries := parsePorcelainZ(out)
	want := []porcelainEntry{
		{Path: "added.txt", Status: GitStatus_Added, Staged: true},
		{Path: "d.txt", Status: GitStatus_Deleted},
		{Path: "m.txt", Status: GitStatus_Modified},
		{Path: "new name.txt", OrigPath: "old.txt", Status: GitStatus_Renamed, Staged: true},
		{Path: "untr ü.txt", Status: GitStatus_Untracked},
		{Path: "conflict.txt", Status: GitStatus_Conflicted, Staged: true},
		{Path: "both.txt", Status: GitStatus_Modified, Staged: true},
	}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d: %+v", len(entries), len(want), entries)
	}
	for i := range want {
		if entries[i] != want[i] {
			t.Errorf("entry %d: got %+v, want %+v", i, entries[i], want[i])
		}
	}
}

func TestParseNumstatZ(t *testing.T) {
	out := []byte("1\t0\tadded.txt\x002\t1\tm.txt\x000\t0\t\x00old.txt\x00new name.txt\x00-\t-\timg.png\x00")
	stats := parseNumstatZ(out)
	if stats["added.txt"] != (numstatEntry{Additions: 1}) {
		t.Errorf("added.txt: %+v", stats["added.txt"])
	}
	if stats["m.txt"] != (numstatEntry{Additions: 2, Deletions: 1}) {
		t.Errorf("m.txt: %+v", stats["m.txt"])
	}
	if _, ok := stats["new name.txt"]; !ok {
		t.Errorf("rename should be keyed by new path: %+v", stats)
	}
	if !stats["img.png"].Binary {
		t.Errorf("img.png should be binary: %+v", stats["img.png"])
	}
}

func TestValidateRepoPath(t *testing.T) {
	root := t.TempDir()
	for _, bad := range []string{"", "..", "../x", "a/../../x", "/etc/passwd", ".", "a/.."} {
		if _, err := validateRepoPath(root, bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
	for _, good := range []string{"a.txt", "sub/dir/a.txt", "a/../b.txt", "..foo"} {
		if _, err := validateRepoPath(root, good); err != nil {
			t.Errorf("expected %q to be accepted: %v", good, err)
		}
	}
	if _, err := validateRepoPath("relative/root", "a.txt"); err == nil {
		t.Errorf("expected relative repo root to be rejected")
	}
}

func TestGetStatusNotRepo(t *testing.T) {
	requireGit(t)
	dir := t.TempDir()
	status, err := GetStatus(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !status.NotRepo {
		t.Errorf("expected NotRepo for %s", dir)
	}
}

func TestGetStatusMixed(t *testing.T) {
	dir := makeMixedRepo(t)
	status, err := GetStatus(context.Background(), filepath.Join(dir, "sub"))
	if err != nil {
		t.Fatal(err)
	}
	if status.NotRepo || status.RepoRoot != dir || status.Branch != "main" || !status.HasHead {
		t.Fatalf("unexpected status header: %+v", status)
	}
	checks := []struct {
		path      string
		status    string
		origPath  string
		additions int
		deletions int
	}{
		{"mod.txt", GitStatus_Modified, "", 2, 1},
		{"del.txt", GitStatus_Deleted, "", 0, 1},
		{"new name.txt", GitStatus_Renamed, "old.txt", 0, 0},
		{"added.txt", GitStatus_Added, "", 1, 0},
		{"untracked ü.txt", GitStatus_Untracked, "", 3, 0},
	}
	if len(status.Files) != len(checks) {
		t.Fatalf("got %d files, want %d: %+v", len(status.Files), len(checks), status.Files)
	}
	for _, c := range checks {
		f := findFile(status.Files, c.path)
		if f == nil {
			t.Errorf("missing %q in %+v", c.path, status.Files)
			continue
		}
		if f.Status != c.status || f.OrigPath != c.origPath || f.Additions != c.additions || f.Deletions != c.deletions {
			t.Errorf("%s: got %+v", c.path, *f)
		}
	}
}

func TestGetStatusUnbornHead(t *testing.T) {
	dir := makeRepo(t)
	writeFile(t, dir, "first.txt", "one\ntwo\n")
	gitCmd(t, dir, "add", "first.txt")
	status, err := GetStatus(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if status.HasHead || status.Branch != "main" {
		t.Errorf("unexpected header: %+v", status)
	}
	f := findFile(status.Files, "first.txt")
	if f == nil || f.Status != GitStatus_Added || f.Additions != 2 {
		t.Fatalf("unexpected file status: %+v", status.Files)
	}
}

func decodeDiff(t *testing.T, rtn *wshrpc.GitFileDiffRtnData) (string, string) {
	t.Helper()
	orig, err := base64.StdEncoding.DecodeString(rtn.OriginalContents64)
	if err != nil {
		t.Fatal(err)
	}
	mod, err := base64.StdEncoding.DecodeString(rtn.ModifiedContents64)
	if err != nil {
		t.Fatal(err)
	}
	return string(orig), string(mod)
}

func TestGetFileDiff(t *testing.T) {
	dir := makeMixedRepo(t)
	ctx := context.Background()
	cases := []struct {
		path     string
		origPath string
		status   string
		wantOrig string
		wantMod  string
	}{
		{"mod.txt", "", GitStatus_Modified, "a\nb\n", "a\nB\nc\n"},
		{"del.txt", "", GitStatus_Deleted, "gone\n", ""},
		{"new name.txt", "old.txt", GitStatus_Renamed, "rename me\nline2\n", "rename me\nline2\n"},
		{"added.txt", "", GitStatus_Added, "", "new\n"},
		{"untracked ü.txt", "", GitStatus_Untracked, "", "u1\nu2\nu3"},
	}
	for _, c := range cases {
		rtn, err := GetFileDiff(ctx, wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: c.path, OrigPath: c.origPath, Status: c.status})
		if err != nil {
			t.Fatalf("%s: %v", c.path, err)
		}
		orig, mod := decodeDiff(t, rtn)
		if orig != c.wantOrig || mod != c.wantMod {
			t.Errorf("%s: got orig=%q mod=%q", c.path, orig, mod)
		}
	}
}

func TestGetFileDiffBinaryAndTooLarge(t *testing.T) {
	dir := makeRepo(t)
	writeFile(t, dir, "bin.dat", "abc\x00def")
	writeFile(t, dir, "big.txt", strings.Repeat("x", MaxDiffFileSize+1))
	ctx := context.Background()
	rtn, err := GetFileDiff(ctx, wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: "bin.dat", Status: GitStatus_Untracked})
	if err != nil {
		t.Fatal(err)
	}
	if !rtn.Binary || rtn.ModifiedContents64 != "" {
		t.Errorf("expected binary result: %+v", rtn)
	}
	rtn, err = GetFileDiff(ctx, wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: "big.txt", Status: GitStatus_Untracked})
	if err != nil {
		t.Fatal(err)
	}
	if !rtn.TooLarge || rtn.ModifiedContents64 != "" {
		t.Errorf("expected too-large result: %+v", rtn)
	}
}

func TestGetFileDiffRejectsEscape(t *testing.T) {
	dir := makeRepo(t)
	_, err := GetFileDiff(context.Background(), wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: "../outside-secret.txt", Status: GitStatus_Untracked})
	if err == nil {
		t.Fatal("expected path escape to be rejected")
	}
}

func TestRevertFile(t *testing.T) {
	dir := makeMixedRepo(t)
	ctx := context.Background()
	reverts := []wshrpc.CommandRemoteGitRevertFileData{
		{RepoRoot: dir, Path: "mod.txt", Status: GitStatus_Modified},
		{RepoRoot: dir, Path: "del.txt", Status: GitStatus_Deleted},
		{RepoRoot: dir, Path: "new name.txt", OrigPath: "old.txt", Status: GitStatus_Renamed},
		{RepoRoot: dir, Path: "added.txt", Status: GitStatus_Added},
		{RepoRoot: dir, Path: "untracked ü.txt", Status: GitStatus_Untracked},
	}
	for _, r := range reverts {
		if err := RevertFile(ctx, r); err != nil {
			t.Fatalf("revert %s: %v", r.Path, err)
		}
	}
	status, err := GetStatus(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Files) != 0 {
		t.Errorf("expected clean tree after reverts, got %+v", status.Files)
	}
	if readFile(t, dir, "mod.txt") != "a\nb\n" || readFile(t, dir, "del.txt") != "gone\n" || readFile(t, dir, "old.txt") != "rename me\nline2\n" {
		t.Errorf("reverted contents do not match HEAD")
	}
	if fileExists(dir, "new name.txt") || fileExists(dir, "added.txt") || fileExists(dir, "untracked ü.txt") {
		t.Errorf("new files should have been removed")
	}
}

func TestRevertFileUnbornHead(t *testing.T) {
	dir := makeRepo(t)
	writeFile(t, dir, "first.txt", "one\n")
	gitCmd(t, dir, "add", "first.txt")
	if err := RevertFile(context.Background(), wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: "first.txt", Status: GitStatus_Added}); err != nil {
		t.Fatal(err)
	}
	if fileExists(dir, "first.txt") {
		t.Errorf("expected first.txt to be removed")
	}
}

func TestRevertFileRejectsEscapeAndDirs(t *testing.T) {
	dir := makeRepo(t)
	outside := filepath.Join(filepath.Dir(dir), "outside-victim.txt")
	if err := os.WriteFile(outside, []byte("keep me"), 0644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(outside)
	ctx := context.Background()
	err := RevertFile(ctx, wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: "../outside-victim.txt", Status: GitStatus_Untracked})
	if err == nil {
		t.Fatal("expected path escape to be rejected")
	}
	if _, statErr := os.Stat(outside); statErr != nil {
		t.Fatalf("file outside repo was deleted: %v", statErr)
	}
	if err := os.MkdirAll(filepath.Join(dir, "somedir"), 0755); err != nil {
		t.Fatal(err)
	}
	err = RevertFile(ctx, wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: "somedir", Status: GitStatus_Untracked})
	if err == nil {
		t.Fatal("expected directory revert to be rejected")
	}
}

// makeSymlinkEscape creates "link" inside the repo pointing at a directory outside it that holds victim.txt
func makeSymlinkEscape(t *testing.T, dir string) string {
	t.Helper()
	outsideDir := t.TempDir()
	victim := filepath.Join(outsideDir, "victim.txt")
	if err := os.WriteFile(victim, []byte("keep me"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideDir, filepath.Join(dir, "link")); err != nil {
		t.Skipf("symlinks not supported: %v", err)
	}
	return victim
}

func TestValidateRepoPathRejectsSymlinkedParent(t *testing.T) {
	dir := makeRepo(t)
	makeSymlinkEscape(t, dir)
	for _, bad := range []string{"link/victim.txt", "link/missing/x.txt"} {
		if _, err := validateRepoPath(dir, bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
	if _, err := validateRepoPath(dir, "link"); err != nil {
		t.Errorf("the symlink itself lives in the repo and should be accepted: %v", err)
	}
	if _, err := validateRepoPath(dir, "gone/dir/file.txt"); err != nil {
		t.Errorf("paths under missing directories should be accepted: %v", err)
	}
}

func TestGetFileDiffRejectsSymlinkEscape(t *testing.T) {
	dir := makeRepo(t)
	makeSymlinkEscape(t, dir)
	_, err := GetFileDiff(context.Background(), wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: "link/victim.txt", Status: GitStatus_Untracked})
	if err == nil {
		t.Fatal("expected symlinked parent escape to be rejected")
	}
}

func TestRevertFileRejectsSymlinkEscape(t *testing.T) {
	dir := makeRepo(t)
	victim := makeSymlinkEscape(t, dir)
	err := RevertFile(context.Background(), wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: "link/victim.txt", Status: GitStatus_Untracked})
	if err == nil {
		t.Fatal("expected symlinked parent escape to be rejected")
	}
	if _, statErr := os.Stat(victim); statErr != nil {
		t.Fatalf("file outside repo was deleted: %v", statErr)
	}
}

func TestRevertFileRefusesToDeleteTrackedFile(t *testing.T) {
	dir := makeMixedRepo(t)
	ctx := context.Background()
	for _, p := range []string{"mod.txt", "sub/keep.txt"} {
		err := RevertFile(ctx, wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: p, Status: GitStatus_Untracked})
		if err == nil {
			t.Errorf("%s: expected stale untracked status to be rejected", p)
		}
		if !fileExists(dir, p) {
			t.Errorf("%s: tracked file was deleted", p)
		}
	}
	if readFile(t, dir, "mod.txt") != "a\nB\nc\n" {
		t.Errorf("uncommitted changes to mod.txt were lost")
	}
}

func TestRevertFileDeletedDirectory(t *testing.T) {
	dir := makeRepo(t)
	writeFile(t, dir, "gone/dir/file.txt", "x\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "init")
	if err := os.RemoveAll(filepath.Join(dir, "gone")); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	data := wshrpc.CommandRemoteGitFileDiffData{RepoRoot: dir, Path: "gone/dir/file.txt", Status: GitStatus_Deleted}
	if _, err := GetFileDiff(ctx, data); err != nil {
		t.Fatalf("diff of file in deleted directory: %v", err)
	}
	if err := RevertFile(ctx, wshrpc.CommandRemoteGitRevertFileData{RepoRoot: dir, Path: "gone/dir/file.txt", Status: GitStatus_Deleted}); err != nil {
		t.Fatal(err)
	}
	if readFile(t, dir, "gone/dir/file.txt") != "x\n" {
		t.Errorf("deleted file was not restored")
	}
}
