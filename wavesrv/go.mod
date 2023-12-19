module github.com/wavetermdev/waveterm/wavesrv

go 1.18

require (
	github.com/alessio/shellescape v1.4.1
	github.com/armon/circbuf v0.0.0-20190214190532-5111143e8da2
	github.com/creack/pty v1.1.18
	github.com/golang-migrate/migrate/v4 v4.16.2
	github.com/google/uuid v1.3.0
	github.com/gorilla/mux v1.8.0
	github.com/gorilla/websocket v1.5.0
	github.com/jmoiron/sqlx v1.3.5
	github.com/mattn/go-sqlite3 v1.14.16
	github.com/sashabaranov/go-openai v1.9.0
	github.com/sawka/txwrap v0.1.2
	github.com/wavetermdev/waveterm/waveshell v0.0.0
	golang.org/x/crypto v0.17.0
	golang.org/x/mod v0.10.0
	golang.org/x/sys v0.15.0
	mvdan.cc/sh/v3 v3.7.0
)

require (
	github.com/google/go-github/v57 v57.0.0 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	go.uber.org/atomic v1.7.0 // indirect
)

replace github.com/wavetermdev/waveterm/waveshell => ../waveshell
