// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveappstore

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	AppNSLocal = "local"
	AppNSDraft = "draft"

	MaxNamespaceLen = 30
	MaxAppNameLen   = 50
)

var (
	namespaceRegex = regexp.MustCompile(`^@?[a-z0-9-]+$`)
	appNameRegex   = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

type FileData struct {
	Contents []byte
	ModTs    int64
}

func MakeAppId(appNS string, appName string) string {
	return appNS + "/" + appName
}

func ParseAppId(appId string) (appNS string, appName string, err error) {
	parts := strings.Split(appId, "/")
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid appId format: must be namespace/name")
	}
	appNS = parts[0]
	appName = parts[1]
	if appNS == "" || appName == "" {
		return "", "", fmt.Errorf("invalid appId: namespace and name cannot be empty")
	}
	return appNS, appName, nil
}

func ValidateAppId(appId string) error {
	appNS, appName, err := ParseAppId(appId)
	if err != nil {
		return err
	}
	if len(appNS) > MaxNamespaceLen {
		return fmt.Errorf("namespace too long: max %d characters", MaxNamespaceLen)
	}
	if len(appName) > MaxAppNameLen {
		return fmt.Errorf("app name too long: max %d characters", MaxAppNameLen)
	}
	if !namespaceRegex.MatchString(appNS) {
		return fmt.Errorf("invalid namespace: must match pattern @?[a-z0-9-]+")
	}
	if !appNameRegex.MatchString(appName) {
		return fmt.Errorf("invalid app name: must match pattern [a-zA-Z0-9_-]+")
	}
	return nil
}

func GetAppDir(appId string) (string, error) {
	if err := ValidateAppId(appId); err != nil {
		return "", err
	}
	appNS, appName, _ := ParseAppId(appId)
	homeDir := wavebase.GetHomeDir()
	return filepath.Join(homeDir, "waveapps", appNS, appName), nil
}

func copyDir(src, dst string) error {
	if err := os.RemoveAll(dst); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("failed to create parent directory: %w", err)
	}

	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		dstPath := filepath.Join(dst, relPath)

		if info.IsDir() {
			return os.MkdirAll(dstPath, info.Mode())
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dstPath, data, info.Mode())
	})
}

func PublishDraft(draftAppId string) (string, error) {
	if err := ValidateAppId(draftAppId); err != nil {
		return "", fmt.Errorf("invalid appId: %w", err)
	}

	appNS, appName, _ := ParseAppId(draftAppId)
	if appNS != AppNSDraft {
		return "", fmt.Errorf("appId must be in draft namespace, got: %s", appNS)
	}

	draftDir, err := GetAppDir(draftAppId)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(draftDir); os.IsNotExist(err) {
		return "", fmt.Errorf("draft app does not exist: %s", draftDir)
	}

	localAppId := MakeAppId(AppNSLocal, appName)
	localDir, err := GetAppDir(localAppId)
	if err != nil {
		return "", err
	}

	if err := copyDir(draftDir, localDir); err != nil {
		return "", err
	}

	return localAppId, nil
}

func RevertDraft(draftAppId string) error {
	if err := ValidateAppId(draftAppId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appNS, appName, _ := ParseAppId(draftAppId)
	if appNS != AppNSDraft {
		return fmt.Errorf("appId must be in draft namespace, got: %s", appNS)
	}

	draftDir, err := GetAppDir(draftAppId)
	if err != nil {
		return err
	}

	localAppId := MakeAppId(AppNSLocal, appName)
	localDir, err := GetAppDir(localAppId)
	if err != nil {
		return err
	}

	if _, err := os.Stat(localDir); os.IsNotExist(err) {
		return fmt.Errorf("local app does not exist: %s", localDir)
	}

	return copyDir(localDir, draftDir)
}

func MakeDraftFromLocal(localAppId string) (string, error) {
	if err := ValidateAppId(localAppId); err != nil {
		return "", fmt.Errorf("invalid appId: %w", err)
	}

	appNS, appName, _ := ParseAppId(localAppId)
	if appNS != AppNSLocal {
		return "", fmt.Errorf("appId must be in local namespace, got: %s", appNS)
	}

	localDir, err := GetAppDir(localAppId)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(localDir); os.IsNotExist(err) {
		return "", fmt.Errorf("local app does not exist: %s", localDir)
	}

	draftAppId := MakeAppId(AppNSDraft, appName)
	draftDir, err := GetAppDir(draftAppId)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(draftDir); err == nil {
		// draft already exists, don't overwrite (that's what RevertDraft is for)
		return draftAppId, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	if err := copyDir(localDir, draftDir); err != nil {
		return "", err
	}

	return draftAppId, nil
}

func DeleteApp(appId string) error {
	if err := ValidateAppId(appId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return err
	}

	if err := os.RemoveAll(appDir); err != nil {
		return fmt.Errorf("failed to delete app directory: %w", err)
	}

	return nil
}

func validateAndResolveFilePath(appDir string, fileName string) (string, error) {
	if filepath.IsAbs(fileName) {
		return "", fmt.Errorf("fileName must be relative, got absolute path: %s", fileName)
	}

	cleanPath := filepath.Clean(fileName)
	if strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, string(filepath.Separator)+"..") {
		return "", fmt.Errorf("path traversal not allowed: %s", fileName)
	}

	fullPath := filepath.Join(appDir, cleanPath)
	resolvedPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve path: %w", err)
	}

	resolvedAppDir, err := filepath.Abs(appDir)
	if err != nil {
		return "", fmt.Errorf("failed to resolve app directory: %w", err)
	}

	if !strings.HasPrefix(resolvedPath, resolvedAppDir+string(filepath.Separator)) && resolvedPath != resolvedAppDir {
		return "", fmt.Errorf("path escapes app directory: %s", fileName)
	}

	return resolvedPath, nil
}

func WriteAppFile(appId string, fileName string, contents []byte) error {
	if err := ValidateAppId(appId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return err
	}

	filePath, err := validateAndResolveFilePath(appDir, fileName)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filePath, contents, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func ReadAppFile(appId string, fileName string) (*FileData, error) {
	if err := ValidateAppId(appId); err != nil {
		return nil, fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return nil, err
	}

	filePath, err := validateAndResolveFilePath(appDir, fileName)
	if err != nil {
		return nil, err
	}

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	contents, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return &FileData{
		Contents: contents,
		ModTs:    fileInfo.ModTime().UnixMilli(),
	}, nil
}

func DeleteAppFile(appId string, fileName string) error {
	if err := ValidateAppId(appId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return err
	}

	filePath, err := validateAndResolveFilePath(appDir, fileName)
	if err != nil {
		return err
	}

	if err := os.Remove(filePath); err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	return nil
}

func ReplaceInAppFile(appId string, fileName string, edits []fileutil.EditSpec) error {
	if err := ValidateAppId(appId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return err
	}

	filePath, err := validateAndResolveFilePath(appDir, fileName)
	if err != nil {
		return err
	}

	return fileutil.ReplaceInFile(filePath, edits)
}

func RenameAppFile(appId string, fromFileName string, toFileName string) error {
	if err := ValidateAppId(appId); err != nil {
		return fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return err
	}

	fromPath, err := validateAndResolveFilePath(appDir, fromFileName)
	if err != nil {
		return fmt.Errorf("invalid source path: %w", err)
	}

	toPath, err := validateAndResolveFilePath(appDir, toFileName)
	if err != nil {
		return fmt.Errorf("invalid destination path: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(toPath), 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	if err := os.Rename(fromPath, toPath); err != nil {
		return fmt.Errorf("failed to rename file: %w", err)
	}

	return nil
}

func ListAllAppFiles(appId string) (*fileutil.ReadDirResult, error) {
	if err := ValidateAppId(appId); err != nil {
		return nil, fmt.Errorf("invalid appId: %w", err)
	}

	appDir, err := GetAppDir(appId)
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(appDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("app directory does not exist: %s", appDir)
	}

	return fileutil.ReadDirRecursive(appDir, 10000)
}

func ListAllApps() ([]string, error) {
	homeDir := wavebase.GetHomeDir()
	waveappsDir := filepath.Join(homeDir, "waveapps")

	if _, err := os.Stat(waveappsDir); os.IsNotExist(err) {
		return []string{}, nil
	}

	namespaces, err := os.ReadDir(waveappsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read waveapps directory: %w", err)
	}

	var appIds []string

	for _, ns := range namespaces {
		if !ns.IsDir() {
			continue
		}

		namespace := ns.Name()
		nsPath := filepath.Join(waveappsDir, namespace)

		apps, err := os.ReadDir(nsPath)
		if err != nil {
			continue
		}

		for _, app := range apps {
			if !app.IsDir() {
				continue
			}

			appName := app.Name()
			appId := MakeAppId(namespace, appName)

			if err := ValidateAppId(appId); err == nil {
				appIds = append(appIds, appId)
			}
		}
	}

	return appIds, nil
}
func GetAppModTime(appId string) (int64, error) {
	if err := ValidateAppId(appId); err != nil {
		return 0, err
	}

	homeDir := wavebase.GetHomeDir()
	appNS, appName, err := ParseAppId(appId)
	if err != nil {
		return 0, err
	}

	appPath := filepath.Join(homeDir, "waveapps", appNS, appName)
	appGoPath := filepath.Join(appPath, "app.go")

	fileInfo, err := os.Stat(appGoPath)
	if err != nil {
		return 0, nil
	}

	return fileInfo.ModTime().UnixMilli(), nil
}

func ListAllEditableApps() ([]wshrpc.AppInfo, error) {
	homeDir := wavebase.GetHomeDir()
	waveappsDir := filepath.Join(homeDir, "waveapps")

	if _, err := os.Stat(waveappsDir); os.IsNotExist(err) {
		return []wshrpc.AppInfo{}, nil
	}

	localApps := make(map[string]bool)
	draftApps := make(map[string]bool)

	localPath := filepath.Join(waveappsDir, AppNSLocal)
	if localEntries, err := os.ReadDir(localPath); err == nil {
		for _, app := range localEntries {
			if app.IsDir() {
				appName := app.Name()
				appId := MakeAppId(AppNSLocal, appName)
				if err := ValidateAppId(appId); err == nil {
					localApps[appName] = true
				}
			}
		}
	}

	draftPath := filepath.Join(waveappsDir, AppNSDraft)
	if draftEntries, err := os.ReadDir(draftPath); err == nil {
		for _, app := range draftEntries {
			if app.IsDir() {
				appName := app.Name()
				appId := MakeAppId(AppNSDraft, appName)
				if err := ValidateAppId(appId); err == nil {
					draftApps[appName] = true
				}
			}
		}
	}

	allAppNames := make(map[string]bool)
	for appName := range localApps {
		allAppNames[appName] = true
	}
	for appName := range draftApps {
		allAppNames[appName] = true
	}

	var appInfos []wshrpc.AppInfo
	for appName := range allAppNames {
		var appId string
		var modTimeAppId string
		if localApps[appName] {
			appId = MakeAppId(AppNSLocal, appName)
		} else {
			appId = MakeAppId(AppNSDraft, appName)
		}

		if draftApps[appName] {
			modTimeAppId = MakeAppId(AppNSDraft, appName)
		} else {
			modTimeAppId = appId
		}

		modTime, _ := GetAppModTime(modTimeAppId)

		appInfos = append(appInfos, wshrpc.AppInfo{
			AppId:   appId,
			ModTime: modTime,
		})
	}

	return appInfos, nil
}

func DraftHasLocalVersion(draftAppId string) (bool, error) {
	if err := ValidateAppId(draftAppId); err != nil {
		return false, fmt.Errorf("invalid appId: %w", err)
	}

	appNS, appName, _ := ParseAppId(draftAppId)
	if appNS != AppNSDraft {
		return false, fmt.Errorf("appId must be in draft namespace, got: %s", appNS)
	}

	localAppId := MakeAppId(AppNSLocal, appName)
	localDir, err := GetAppDir(localAppId)
	if err != nil {
		return false, err
	}

	if _, err := os.Stat(localDir); os.IsNotExist(err) {
		return false, nil
	}

	return true, nil
}

// RenameLocalApp renames a local app by renaming its directories in both the local and draft namespaces.
// It takes the current app name and the new app name (without namespace prefixes).
// Both local/[appName] and draft/[appName] will be renamed if they exist.
// Returns an error if the app doesn't exist in either namespace, if the new name is invalid,
// or if the new name conflicts with an existing app.
func RenameLocalApp(appName string, newAppName string) error {
	// Validate the old app name by constructing a valid appId
	oldLocalAppId := MakeAppId(AppNSLocal, appName)
	if err := ValidateAppId(oldLocalAppId); err != nil {
		return fmt.Errorf("invalid app name: %w", err)
	}

	// Validate the new app name by constructing a valid appId
	newLocalAppId := MakeAppId(AppNSLocal, newAppName)
	if err := ValidateAppId(newLocalAppId); err != nil {
		return fmt.Errorf("invalid new app name: %w", err)
	}

	homeDir := wavebase.GetHomeDir()
	waveappsDir := filepath.Join(homeDir, "waveapps")

	oldLocalDir := filepath.Join(waveappsDir, AppNSLocal, appName)
	newLocalDir := filepath.Join(waveappsDir, AppNSLocal, newAppName)
	oldDraftDir := filepath.Join(waveappsDir, AppNSDraft, appName)
	newDraftDir := filepath.Join(waveappsDir, AppNSDraft, newAppName)

	// Check if at least one of the apps exists
	localExists := false
	draftExists := false
	if _, err := os.Stat(oldLocalDir); err == nil {
		localExists = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check local app: %w", err)
	}

	if _, err := os.Stat(oldDraftDir); err == nil {
		draftExists = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check draft app: %w", err)
	}

	if !localExists && !draftExists {
		return fmt.Errorf("app '%s' does not exist in local or draft namespace", appName)
	}

	// Check if new app name already exists in either namespace
	if _, err := os.Stat(newLocalDir); err == nil {
		return fmt.Errorf("local app '%s' already exists", newAppName)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check if new local app exists: %w", err)
	}

	if _, err := os.Stat(newDraftDir); err == nil {
		return fmt.Errorf("draft app '%s' already exists", newAppName)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check if new draft app exists: %w", err)
	}

	// Rename local app if it exists
	if localExists {
		if err := os.Rename(oldLocalDir, newLocalDir); err != nil {
			return fmt.Errorf("failed to rename local app: %w", err)
		}
	}

	// Rename draft app if it exists
	if draftExists {
		if err := os.Rename(oldDraftDir, newDraftDir); err != nil {
			// If local was renamed but draft fails, try to rollback local rename
			if localExists {
				if rollbackErr := os.Rename(newLocalDir, oldLocalDir); rollbackErr != nil {
					return fmt.Errorf("failed to rename draft app (and failed to rollback local rename: %v): %w", rollbackErr, err)
				}
			}
			return fmt.Errorf("failed to rename draft app: %w", err)
		}
	}

	return nil
}
