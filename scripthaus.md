
```bash
# @scripthaus command build
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.2-darwin.amd64 main-mshell.go
```

```bash
# @scripthaus command fullbuild
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o ~/.mshell/mshell-v0.2 main-mshell.go
GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.2-linux.amd64 main-mshell.go
GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.2-linux.arm64 main-mshell.go
GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.2-darwin.amd64 main-mshell.go
GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.2-darwin.arm64 main-mshell.go
```


