// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package build

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
)

const AppInitFnName = "AppInit"

func buildImportsMap(dir string) (map[string]bool, error) {
	imports := make(map[string]bool)

	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, fmt.Errorf("failed to list go files: %w", err)
	}

	fset := token.NewFileSet()
	for _, file := range files {
		node, err := parser.ParseFile(fset, file, nil, parser.ImportsOnly)
		if err != nil {
			continue // Skip files that can't be parsed
		}

		for _, imp := range node.Imports {
			// Remove quotes from import path
			importPath := strings.Trim(imp.Path.Value, `"`)
			imports[importPath] = true
		}
	}

	return imports, nil
}

type parsedAppInfo struct {
	HasAppInit bool
}

func parseAndValidateAppFile(appFS fs.FS) (*parsedAppInfo, error) {
	appGoFile, err := fs.ReadFile(appFS, MainAppFileName)
	if err != nil {
		return &parsedAppInfo{HasAppInit: false}, nil
	}

	fset := token.NewFileSet()
	node, err := parser.ParseFile(fset, MainAppFileName, appGoFile, 0)
	if err != nil {
		return &parsedAppInfo{HasAppInit: false}, nil
	}

	hasAppInit := false
	for _, decl := range node.Decls {
		funcDecl, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}

		if funcDecl.Name.Name == "init" {
			hasNoParams := funcDecl.Type.Params == nil || len(funcDecl.Type.Params.List) == 0
			hasNoResults := funcDecl.Type.Results == nil || len(funcDecl.Type.Results.List) == 0
			if hasNoParams && hasNoResults {
				return nil, fmt.Errorf("tsunami apps may not define an init() function, use %s for initialization", AppInitFnName)
			}
		}

		if funcDecl.Name.Name == AppInitFnName {
			if funcDecl.Type.Params != nil && len(funcDecl.Type.Params.List) > 0 {
				return nil, fmt.Errorf("%s function must take no parameters, but has %d parameter(s)", AppInitFnName, len(funcDecl.Type.Params.List))
			}

			if funcDecl.Type.Results == nil || len(funcDecl.Type.Results.List) != 1 {
				return nil, fmt.Errorf("%s function must return exactly one value of type error", AppInitFnName)
			}

			returnType := funcDecl.Type.Results.List[0]
			ident, ok := returnType.Type.(*ast.Ident)
			if !ok || ident.Name != "error" {
				return nil, fmt.Errorf("%s function must return error, not %v", AppInitFnName, returnType.Type)
			}

			hasAppInit = true
		}
	}

	return &parsedAppInfo{HasAppInit: hasAppInit}, nil
}
