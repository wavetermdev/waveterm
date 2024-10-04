package docsite

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var docsiteStaticPath = filepath.Join(wavebase.GetWaveAppPath(), "docsite")

var docsiteHandler http.Handler

func GetDocsiteHandler() http.Handler {
	stat, err := os.Stat(docsiteStaticPath)
	if docsiteHandler == nil {
		log.Println("Docsite is nil, initializing")
		if err == nil && stat.IsDir() {
			log.Printf("Found static site at %s, serving\n", docsiteStaticPath)
			docsiteHandler = http.FileServer(http.Dir(docsiteStaticPath))
		} else {
			log.Println("Did not find static site, serving not found handler")
			docsiteHandler = http.NotFoundHandler()
		}
	}
	return docsiteHandler
}
