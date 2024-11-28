package docsite

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var docsiteHandler http.Handler

func GetDocsiteHandler() http.Handler {
	docsiteStaticPath := filepath.Join(wavebase.GetWaveAppPath(), "docsite")
	stat, err := os.Stat(docsiteStaticPath)
	if docsiteHandler == nil {
		log.Println("Docsite is nil, initializing")
		if err == nil && stat.IsDir() {
			log.Printf("Found static site at %s, serving\n", docsiteStaticPath)
			docsiteHandler = http.FileServer(HTMLDir{http.Dir(docsiteStaticPath)})
		} else {
			log.Printf("Did not find static site at %s, serving not found handler. stat: %v, err: %v\n", docsiteStaticPath, stat, err)
			docsiteHandler = http.NotFoundHandler()
		}
	}
	return docsiteHandler
}

type HTMLDir struct {
	d http.Dir
}

func (d HTMLDir) Open(name string) (http.File, error) {
	// Try name as supplied
	f, err := d.d.Open(name)
	if os.IsNotExist(err) {
		// Not found, try with .html
		if f, err := d.d.Open(name + ".html"); err == nil {
			return f, nil
		}
	}
	return f, err
}
