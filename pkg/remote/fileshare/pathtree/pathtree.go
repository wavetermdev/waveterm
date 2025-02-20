package pathtree

import (
	"log"
	"strings"
)

type WalkFunc func(path string, numChildren int) error

type Tree struct {
	Root      *Node
	RootPath  string
	nodes     map[string]*Node
	delimiter string
}

type Node struct {
	Children map[string]*Node
}

func (n *Node) Walk(curPath string, walkFunc WalkFunc, delimiter string) error {
	if err := walkFunc(curPath, len(n.Children)); err != nil {
		return err
	}
	for name, child := range n.Children {
		if err := child.Walk(curPath+delimiter+name, walkFunc, delimiter); err != nil {
			return err
		}
	}
	return nil
}

func NewTree(path string, delimiter string) *Tree {
	if len(delimiter) > 1 {
		log.Printf("pathtree.NewTree: Warning: multi-character delimiter '%s' may cause unexpected behavior", delimiter)
	}
	if path != "" && !strings.HasSuffix(path, delimiter) {
		path += delimiter
	}
	return &Tree{
		Root: &Node{
			Children: make(map[string]*Node),
		},
		nodes:     make(map[string]*Node),
		RootPath:  path,
		delimiter: delimiter,
	}
}

func (t *Tree) Add(path string) {
	// Validate input
	if path == "" {
		return
	}
	var relativePath string
	if t.RootPath == "" {
		relativePath = path
	} else {
		relativePath = strings.TrimPrefix(path, t.RootPath)

		// If the path is not a child of the root path, ignore it
		if relativePath == path {
			return
		}

	}

	// If the path is already in the tree, ignore it
	if t.nodes[relativePath] != nil {
		return
	}

	components := strings.Split(relativePath, t.delimiter)
	// Validate path components
	for _, component := range components {
		if component == "" || component == "." || component == ".." {
			log.Printf("pathtree.Add: invalid path component: %s", component)
			return // Skip invalid paths
		}
	}

	// Quick check to see if the parent path is already in the tree, in which case we can skip the loop
	if parent := t.tryAddToExistingParent(components); parent {
		return
	}

	t.addNewPath(components)
}

func (t *Tree) tryAddToExistingParent(components []string) bool {
	if len(components) <= 1 {
		return false
	}
	parentPath := strings.Join(components[:len(components)-1], t.delimiter)
	if t.nodes[parentPath] == nil {
		return false
	}
	lastPathComponent := components[len(components)-1]
	t.nodes[parentPath].Children[lastPathComponent] = &Node{
		Children: make(map[string]*Node),
	}
	t.nodes[strings.Join(components, t.delimiter)] = t.nodes[parentPath].Children[lastPathComponent]
	return true
}

func (t *Tree) addNewPath(components []string) {
	currentNode := t.Root
	for i, component := range components {
		if _, ok := currentNode.Children[component]; !ok {
			currentNode.Children[component] = &Node{
				Children: make(map[string]*Node),
			}
			curPath := strings.Join(components[:i+1], t.delimiter)
			t.nodes[curPath] = currentNode.Children[component]
		}
		currentNode = currentNode.Children[component]
	}
}

func (t *Tree) Walk(walkFunc WalkFunc) error {
	for key, child := range t.Root.Children {
		if err := child.Walk(t.RootPath+key, walkFunc, t.delimiter); err != nil {
			return err
		}
	}
	return nil
}
