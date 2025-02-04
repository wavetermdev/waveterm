package pathtree

import (
	"log"
	"strings"
)

type WalkFunc func(path string, isLeaf bool) error

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
	if err := walkFunc(curPath, len(n.Children) == 0); err != nil {
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
	if !strings.HasSuffix(path, delimiter) {
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
	relativePath := strings.TrimPrefix(path, t.RootPath)
	log.Printf("relativePath: %s", relativePath)

	// If the path is not a child of the root path, ignore it
	if relativePath == path {
		return
	}

	// If the path is already in the tree, ignore it
	if t.nodes[relativePath] != nil {
		return
	}

	components := strings.Split(relativePath, t.delimiter)

	// Quick check to see if the parent path is already in the tree, in which case we can skip the loop
	if len(components) > 1 {
		parentPath := strings.Join(components[:len(components)-1], t.delimiter)
		log.Printf("parentPath: %s", parentPath)
		if t.nodes[parentPath] != nil {
			lastPathComponent := components[len(components)-1]
			t.nodes[parentPath].Children[lastPathComponent] = &Node{
				Children: make(map[string]*Node),
			}
			t.nodes[relativePath] = t.nodes[parentPath].Children[lastPathComponent]
			return
		}
	}

	currentNode := t.Root
	for i, component := range components {
		if _, ok := currentNode.Children[component]; !ok {
			currentNode.Children[component] = &Node{
				Children: make(map[string]*Node),
			}
			curPath := strings.Join(components[:i+1], t.delimiter)
			log.Printf("curPath: %s", curPath)
			t.nodes[curPath] = currentNode.Children[component]
		}
		currentNode = currentNode.Children[component]
	}
}

func (t *Tree) Walk(walkFunc WalkFunc) error {
	return t.Root.Walk(strings.TrimSuffix(t.RootPath, t.delimiter), walkFunc, t.delimiter)
}
