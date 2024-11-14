module github.com/wavetermdev/waveterm

go 1.22.4

require (
	github.com/alexflint/go-filemutex v1.3.0
	github.com/creack/pty v1.1.21
	github.com/fsnotify/fsnotify v1.8.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/golang-migrate/migrate/v4 v4.18.1
	github.com/google/uuid v1.6.0
	github.com/gorilla/handlers v1.5.2
	github.com/gorilla/mux v1.8.1
	github.com/gorilla/websocket v1.5.3
	github.com/jmoiron/sqlx v1.4.0
	github.com/kevinburke/ssh_config v1.2.0
	github.com/mattn/go-sqlite3 v1.14.24
	github.com/mitchellh/mapstructure v1.5.0
	github.com/sashabaranov/go-openai v1.35.6
	github.com/sawka/txwrap v0.2.0
	github.com/shirou/gopsutil/v4 v4.24.10
	github.com/skeema/knownhosts v1.3.0
	github.com/spf13/cobra v1.8.1
	github.com/ubuntu/gowsl v0.0.0-20240906163211-049fd49bd93b
	github.com/wavetermdev/htmltoken v0.2.0
	golang.org/x/crypto v0.29.0
	golang.org/x/sys v0.27.0
	golang.org/x/term v0.26.0
)

require (
	github.com/ebitengine/purego v0.8.1 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0 // indirect
	github.com/power-devops/perfstat v0.0.0-20210106213030-5aafc221ea8c // indirect
	github.com/sirupsen/logrus v1.9.3 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	github.com/tklauser/go-sysconf v0.3.12 // indirect
	github.com/tklauser/numcpus v0.6.1 // indirect
	github.com/ubuntu/decorate v0.0.0-20230125165522-2d5b0a9bb117 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	go.uber.org/atomic v1.7.0 // indirect
	golang.org/x/net v0.29.0 // indirect
)

replace github.com/kevinburke/ssh_config => github.com/wavetermdev/ssh_config v0.0.0-20241027232332-ed124367682d

replace github.com/creack/pty => github.com/photostorm/pty v1.1.19-0.20230903182454-31354506054b
