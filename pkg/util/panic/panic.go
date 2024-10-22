package panic

import (
	"log"
	"os"
)

var shouldPanic = len(os.Getenv("NO_PANIC")) == 0

// Wraps log.Panic, ignored if NO_PANIC is set
func Panic(message string) {
	if shouldPanic {
		log.Panic(message)
	}
}
