package pathtree_test

import (
	"errors"
	"log"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/pathtree"
)

func TestAdd(t *testing.T) {
	t.Parallel()

	tree := initializeTree()

	// Check that the tree has the expected structure
	if len(tree.Root.Children) != 3 {
		t.Errorf("expected 3 children, got %d", len(tree.Root.Children))
	}

	if len(tree.Root.Children["a"].Children) != 3 {
		t.Errorf("expected 3 children, got %d", len(tree.Root.Children["a"].Children))
	}

	if len(tree.Root.Children["b"].Children) != 1 {
		t.Errorf("expected 1 child, got %d", len(tree.Root.Children["b"].Children))
	}

	if len(tree.Root.Children["b"].Children["g"].Children) != 1 {
		t.Errorf("expected 1 child, got %d", len(tree.Root.Children["b"].Children["g"].Children))
	}

	if len(tree.Root.Children["b"].Children["g"].Children["h"].Children) != 0 {
		t.Errorf("expected 0 children, got %d", len(tree.Root.Children["b"].Children["g"].Children["h"].Children))
	}

	if len(tree.Root.Children["c"].Children) != 0 {
		t.Errorf("expected 0 children, got %d", len(tree.Root.Children["c"].Children))
	}

	// Check that adding the same path again does not change the tree
	tree.Add("root/a/d")
	if len(tree.Root.Children["a"].Children) != 3 {
		t.Errorf("expected 3 children, got %d", len(tree.Root.Children["a"].Children))
	}

	// Check that adding a path that is not a child of the root path does not change the tree
	tree.Add("etc/passwd")
	if len(tree.Root.Children) != 3 {
		t.Errorf("expected 3 children, got %d", len(tree.Root.Children))
	}
}

func TestWalk(t *testing.T) {
	t.Parallel()

	tree := initializeTree()

	// Check that the tree traverses all nodes and identifies leaf nodes correctly
	pathMap := make(map[string]int)
	err := tree.Walk(func(path string, numChildren int) error {
		pathMap[path] = numChildren
		return nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	expectedPathMap := map[string]int{
		"root/a":     3,
		"root/a/d":   0,
		"root/a/e":   0,
		"root/a/f":   0,
		"root/b":     1,
		"root/b/g":   1,
		"root/b/g/h": 0,
		"root/c":     0,
	}

	log.Printf("pathMap: %v", pathMap)

	for path, numChildren := range expectedPathMap {
		if pathMap[path] != numChildren {
			t.Errorf("expected %d children for path %s, got %d", numChildren, path, pathMap[path])
		}
	}

	expectedError := errors.New("test error")

	// Check that the walk function returns an error if it is returned by the walk function
	err = tree.Walk(func(path string, numChildren int) error {
		return expectedError
	})
	if err != expectedError {
		t.Errorf("expected error %v, got %v", expectedError, err)
	}
}

func initializeTree() *pathtree.Tree {
	tree := pathtree.NewTree("root/", "/")
	tree.Add("root/a")
	tree.Add("root/b")
	tree.Add("root/c")
	tree.Add("root/a/d")
	tree.Add("root/a/e")
	tree.Add("root/a/f")
	tree.Add("root/b/g")
	tree.Add("root/b/g/h")
	log.Printf("tree: %v", tree)
	return tree
}
