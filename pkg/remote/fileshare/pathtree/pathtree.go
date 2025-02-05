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
	log.Printf("tree.Add: path: %s", path)
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
	log.Printf("relativePath: %s", relativePath)

	// If the path is already in the tree, ignore it
	if t.nodes[relativePath] != nil {
		return
	}

	components := strings.Split(relativePath, t.delimiter)
	log.Printf("components: %v", components)

	// // Quick check to see if the parent path is already in the tree, in which case we can skip the loop
	// if len(components) > 1 {
	// 	parentPath := strings.Join(components[:len(components)-1], t.delimiter)
	// 	log.Printf("parentPath: %s", parentPath)
	// 	if t.nodes[parentPath] != nil {
	// 		lastPathComponent := components[len(components)-1]
	// 		t.nodes[parentPath].Children[lastPathComponent] = &Node{
	// 			Children: make(map[string]*Node),
	// 		}
	// 		t.nodes[relativePath] = t.nodes[parentPath].Children[lastPathComponent]
	// 		return
	// 	}
	// }

	currentNode := t.Root
	for i, component := range components {
		log.Printf("component: %s", component)
		if _, ok := currentNode.Children[component]; !ok {
			log.Printf("Adding component: %s", component)
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
	log.Printf("RootPath: %s", t.RootPath)
	for key, child := range t.Root.Children {
		if err := child.Walk(t.RootPath+key, walkFunc, t.delimiter); err != nil {
			return err
		}
	}
	return nil
}
