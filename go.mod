module github.com/wavetermdev/waveterm

go 1.23.4

require (
	github.com/alexflint/go-filemutex v1.3.0
	github.com/creack/pty v1.1.21
	github.com/fsnotify/fsnotify v1.8.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/golang-migrate/migrate/v4 v4.18.1
	github.com/google/generative-ai-go v0.19.0
	github.com/google/uuid v1.6.0
	github.com/gorilla/handlers v1.5.2
	github.com/gorilla/mux v1.8.1
	github.com/gorilla/websocket v1.5.3
	github.com/jmoiron/sqlx v1.4.0
	github.com/kevinburke/ssh_config v1.2.0
	github.com/mattn/go-sqlite3 v1.14.24
	github.com/mitchellh/mapstructure v1.5.0
	github.com/sashabaranov/go-openai v1.36.1
	github.com/sawka/txwrap v0.2.0
	github.com/shirou/gopsutil/v4 v4.24.12
	github.com/skeema/knownhosts v1.3.0
	github.com/skratchdot/open-golang v0.0.0-20200116055534-eef842397966
	github.com/spf13/cobra v1.8.1
	github.com/ubuntu/gowsl v0.0.0-20240906163211-049fd49bd93b
	github.com/wavetermdev/htmltoken v0.2.0
	golang.org/x/crypto v0.32.0
	golang.org/x/mod v0.22.0
	golang.org/x/sys v0.29.0
	golang.org/x/term v0.28.0
	google.golang.org/api v0.214.0
)

require (
	cloud.google.com/go v0.115.0 // indirect
	cloud.google.com/go/ai v0.8.0 // indirect
	cloud.google.com/go/auth v0.13.0 // indirect
	cloud.google.com/go/auth/oauth2adapt v0.2.6 // indirect
	cloud.google.com/go/compute/metadata v0.6.0 // indirect
	cloud.google.com/go/longrunning v0.5.7 // indirect
	github.com/ebitengine/purego v0.8.1 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/go-logr/logr v1.4.2 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/google/s2a-go v0.1.8 // indirect
	github.com/googleapis/enterprise-certificate-proxy v0.3.4 // indirect
	github.com/googleapis/gax-go/v2 v2.14.0 // indirect
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
	go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc v0.54.0 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.54.0 // indirect
	go.opentelemetry.io/otel v1.29.0 // indirect
	go.opentelemetry.io/otel/metric v1.29.0 // indirect
	go.opentelemetry.io/otel/trace v1.29.0 // indirect
	go.uber.org/atomic v1.7.0 // indirect
	golang.org/x/net v0.33.0 // indirect
	golang.org/x/oauth2 v0.24.0 // indirect
	golang.org/x/sync v0.10.0 // indirect
	golang.org/x/text v0.21.0 // indirect
	golang.org/x/time v0.8.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20241104194629-dd2ea8efbc28 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20241209162323-e6fa225c2576 // indirect
	google.golang.org/grpc v1.67.1 // indirect
	google.golang.org/protobuf v1.35.2 // indirect
)

replace github.com/kevinburke/ssh_config => github.com/wavetermdev/ssh_config v0.0.0-20241219203747-6409e4292f34

replace github.com/creack/pty => github.com/photostorm/pty v1.1.19-0.20230903182454-31354506054b
