// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitutil

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	GitStatus_Modified   = "modified"
	GitStatus_Added      = "added"
	GitStatus_Deleted    = "deleted"
	GitStatus_Renamed    = "renamed"
	GitStatus_Untracked  = "untracked"
	GitStatus_Conflicted = "conflicted"
)

const (
	MaxDiffFileSize = 2 * 1024 * 1024
	MaxStatusFiles  = 1000
	BinarySniffSize = 8000
)

var conflictCodes = map[string]bool{
	"DD": true, "AU": true, "UD": true, "UA": true, "DU": true, "AA": true, "UU": true,
}

type porcelainEntry struct {
	Path     string
	OrigPath string
	Status   string
	Staged   bool
}

type numstatEntry struct {
	Additions int
	Deletions int
	Binary    bool
}

func runGit(ctx context.Context, dir string, args ...string) ([]byte, error) {
	fullArgs := append([]string{"-C", dir, "-c", "core.quotepath=off"}, args...)
	cmd := exec.CommandContext(ctx, "git", fullArgs...)
	// optional locks would make our background polling contend with the user's own git commands
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return nil, fmt.Errorf("git executable not found in PATH")
		}
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return nil, fmt.Errorf("git %s: %s", args[0], errMsg)
	}
	return stdout.Bytes(), nil
}

func classifyPorcelain(xy string) string {
	if xy == "??" {
		return GitStatus_Untracked
	}
	if conflictCodes[xy] {
		return GitStatus_Conflicted
	}
	x, y := xy[0], xy[1]
	if x == 'R' || y == 'R' {
		return GitStatus_Renamed
	}
	if x == 'A' || x == 'C' {
		return GitStatus_Added
	}
	if x == 'D' || y == 'D' {
		return GitStatus_Deleted
	}
	return GitStatus_Modified
}

// parsePorcelainZ parses `git status --porcelain=v1 -z` output.
// Renames and copies are encoded as "XY NEWPATH\0ORIGPATH\0".
func parsePorcelainZ(out []byte) []porcelainEntry {
	var rtn []porcelainEntry
	parts := strings.Split(string(out), "\x00")
	for i := 0; i < len(parts); i++ {
		rec := parts[i]
		if len(rec) < 4 || rec[2] != ' ' {
			continue
		}
		xy := rec[:2]
		if xy == "!!" {
			continue
		}
		entry := porcelainEntry{
			Path:   rec[3:],
			Status: classifyPorcelain(xy),
			Staged: xy[0] != ' ' && xy[0] != '?',
		}
		if xy[0] == 'R' || xy[0] == 'C' || xy[1] == 'R' || xy[1] == 'C' {
			if i+1 < len(parts) {
				i++
				if entry.Status == GitStatus_Renamed {
					entry.OrigPath = parts[i]
				}
			}
		}
		rtn = append(rtn, entry)
	}
	return rtn
}

// parseNumstatZ parses `git diff --numstat -z` output, keyed by the (new) path.
// Renames are encoded as "ADD\tDEL\t\0ORIGPATH\0NEWPATH\0".
func parseNumstatZ(out []byte) map[string]numstatEntry {
	rtn := make(map[string]numstatEntry)
	parts := strings.Split(string(out), "\x00")
	for i := 0; i < len(parts); i++ {
		fields := strings.SplitN(parts[i], "\t", 3)
		if len(fields) != 3 {
			continue
		}
		filePath := fields[2]
		if filePath == "" {
			if i+2 >= len(parts) {
				break
			}
			filePath = parts[i+2]
			i += 2
		}
		var entry numstatEntry
		if fields[0] == "-" && fields[1] == "-" {
			entry.Binary = true
		} else {
			entry.Additions, _ = strconv.Atoi(fields[0])
			entry.Deletions, _ = strconv.Atoi(fields[1])
		}
		rtn[filePath] = entry
	}
	return rtn
}

func isBinaryContent(data []byte) bool {
	sniff := data
	if len(sniff) > BinarySniffSize {
		sniff = sniff[:BinarySniffSize]
	}
	return bytes.IndexByte(sniff, 0) != -1
}

func countLines(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	n := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		n++
	}
	return n
}

// validateRepoPath ensures a repo-relative path (as supplied by the client) cannot escape the repo root.
func validateRepoPath(repoRoot string, relPath string) (string, error) {
	if !filepath.IsAbs(repoRoot) {
		return "", fmt.Errorf("repository root %q must be absolute", repoRoot)
	}
	if relPath == "" {
		return "", fmt.Errorf("empty path")
	}
	if filepath.IsAbs(relPath) || path.IsAbs(relPath) || filepath.VolumeName(relPath) != "" {
		return "", fmt.Errorf("path %q must be relative to the repository root", relPath)
	}
	cleaned := path.Clean(filepath.ToSlash(relPath))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("path %q is outside the repository", relPath)
	}
	fullPath := filepath.Join(repoRoot, filepath.FromSlash(cleaned))
	rel, err := filepath.Rel(repoRoot, fullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is outside the repository", relPath)
	}
	return fullPath, nil
}

func hasHead(ctx context.Context, repoRoot string) bool {
	_, err := runGit(ctx, repoRoot, "rev-parse", "--verify", "--quiet", "HEAD")
	return err == nil
}

func getBranch(ctx context.Context, repoRoot string, headExists bool) string {
	out, err := runGit(ctx, repoRoot, "symbolic-ref", "--short", "-q", "HEAD")
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	if !headExists {
		return ""
	}
	out, err = runGit(ctx, repoRoot, "rev-parse", "--short", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func GetRepoRoot(ctx context.Context, cwd string) (string, error) {
	out, err := runGit(ctx, cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	root := strings.TrimSpace(string(out))
	if root == "" {
		return "", fmt.Errorf("not a git repository")
	}
	return filepath.FromSlash(root), nil
}

func GetStatus(ctx context.Context, cwd string) (*wshrpc.GitStatusRtnData, error) {
	if _, err := os.Stat(cwd); err != nil {
		return nil, fmt.Errorf("cannot access directory %q: %w", cwd, err)
	}
	if _, err := exec.LookPath("git"); err != nil {
		return nil, fmt.Errorf("git executable not found in PATH")
	}
	repoRoot, err := GetRepoRoot(ctx, cwd)
	if err != nil {
		return &wshrpc.GitStatusRtnData{NotRepo: true}, nil
	}
	headExists := hasHead(ctx, repoRoot)
	rtn := &wshrpc.GitStatusRtnData{
		RepoRoot: repoRoot,
		Branch:   getBranch(ctx, repoRoot, headExists),
		HasHead:  headExists,
	}
	statusOut, err := runGit(ctx, repoRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	entries := parsePorcelainZ(statusOut)
	if len(entries) > MaxStatusFiles {
		entries = entries[:MaxStatusFiles]
		rtn.Truncated = true
	}
	var numstat map[string]numstatEntry
	if headExists {
		numstatOut, err := runGit(ctx, repoRoot, "diff", "--numstat", "-z", "HEAD")
		if err == nil {
			numstat = parseNumstatZ(numstatOut)
		}
	}
	rtn.Files = make([]wshrpc.GitFileStatus, 0, len(entries))
	for _, entry := range entries {
		fileStatus := wshrpc.GitFileStatus{
			Path:     entry.Path,
			OrigPath: entry.OrigPath,
			Status:   entry.Status,
			Staged:   entry.Staged,
		}
		if ns, ok := numstat[entry.Path]; ok {
			fileStatus.Additions = ns.Additions
			fileStatus.Deletions = ns.Deletions
			fileStatus.Binary = ns.Binary
		} else if entry.Status == GitStatus_Untracked || (entry.Status == GitStatus_Added && !headExists) {
			fillNewFileStats(repoRoot, &fileStatus)
		}
		rtn.Files = append(rtn.Files, fileStatus)
	}
	return rtn, nil
}

func fillNewFileStats(repoRoot string, fileStatus *wshrpc.GitFileStatus) {
	fullPath, err := validateRepoPath(repoRoot, fileStatus.Path)
	if err != nil {
		return
	}
	finfo, err := os.Stat(fullPath)
	if err != nil || !finfo.Mode().IsRegular() || finfo.Size() > MaxDiffFileSize {
		return
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	if isBinaryContent(data) {
		fileStatus.Binary = true
		return
	}
	fileStatus.Additions = countLines(data)
}

func readHeadBlob(ctx context.Context, repoRoot string, relPath string) ([]byte, bool, error) {
	spec := "HEAD:" + filepath.ToSlash(relPath)
	sizeOut, err := runGit(ctx, repoRoot, "cat-file", "-s", spec)
	if err != nil {
		return nil, false, nil
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(sizeOut)), 10, 64)
	if err != nil {
		return nil, false, fmt.Errorf("cannot parse blob size for %q: %w", relPath, err)
	}
	if size > MaxDiffFileSize {
		return nil, true, nil
	}
	// --filters applies eol/smudge conversion so the HEAD side matches what a checkout would produce
	data, err := runGit(ctx, repoRoot, "cat-file", "--filters", spec)
	if err != nil {
		return nil, false, err
	}
	return data, false, nil
}

func readWorktreeFile(fullPath string) ([]byte, bool, error) {
	finfo, err := os.Lstat(fullPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if finfo.Mode()&os.ModeSymlink != 0 {
		// git stores a symlink's target as its blob contents, so diff against that rather than following it
		target, err := os.Readlink(fullPath)
		if err != nil {
			return nil, false, err
		}
		return []byte(target), false, nil
	}
	if finfo.IsDir() {
		return nil, false, fmt.Errorf("%q is a directory", fullPath)
	}
	if finfo.Size() > MaxDiffFileSize {
		return nil, true, nil
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, false, err
	}
	return data, false, nil
}

func GetFileDiff(ctx context.Context, data wshrpc.CommandRemoteGitFileDiffData) (*wshrpc.GitFileDiffRtnData, error) {
	repoRoot := data.RepoRoot
	fullPath, err := validateRepoPath(repoRoot, data.Path)
	if err != nil {
		return nil, err
	}
	origRelPath := data.Path
	if data.OrigPath != "" {
		if _, err := validateRepoPath(repoRoot, data.OrigPath); err != nil {
			return nil, err
		}
		origRelPath = data.OrigPath
	}
	rtn := &wshrpc.GitFileDiffRtnData{}
	var original, modified []byte
	if data.Status != GitStatus_Untracked && data.Status != GitStatus_Added {
		var tooLarge bool
		original, tooLarge, err = readHeadBlob(ctx, repoRoot, origRelPath)
		if err != nil {
			return nil, err
		}
		if tooLarge {
			rtn.TooLarge = true
			return rtn, nil
		}
	}
	if data.Status != GitStatus_Deleted {
		var tooLarge bool
		modified, tooLarge, err = readWorktreeFile(fullPath)
		if err != nil {
			return nil, err
		}
		if tooLarge {
			rtn.TooLarge = true
			return rtn, nil
		}
	}
	if isBinaryContent(original) || isBinaryContent(modified) {
		rtn.Binary = true
		return rtn, nil
	}
	rtn.OriginalContents64 = base64.StdEncoding.EncodeToString(original)
	rtn.ModifiedContents64 = base64.StdEncoding.EncodeToString(modified)
	return rtn, nil
}

func RevertFile(ctx context.Context, data wshrpc.CommandRemoteGitRevertFileData) error {
	repoRoot := data.RepoRoot
	fullPath, err := validateRepoPath(repoRoot, data.Path)
	if err != nil {
		return err
	}
	if data.OrigPath != "" {
		if _, err := validateRepoPath(repoRoot, data.OrigPath); err != nil {
			return err
		}
	}
	if data.Status == GitStatus_Untracked {
		finfo, err := os.Lstat(fullPath)
		if err != nil {
			return err
		}
		if finfo.IsDir() {
			return fmt.Errorf("refusing to delete directory %q", data.Path)
		}
		return os.Remove(fullPath)
	}
	if !hasHead(ctx, repoRoot) {
		// with no commits yet, "reverting" a staged file means dropping it entirely
		_, err := runGit(ctx, repoRoot, "rm", "-f", "-q", "--", data.Path)
		return err
	}
	args := []string{"restore", "--source=HEAD", "--staged", "--worktree", "--", data.Path}
	if data.OrigPath != "" {
		args = append(args, data.OrigPath)
	}
	_, err = runGit(ctx, repoRoot, args...)
	return err
}
