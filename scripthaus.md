
```bash
# @scripthaus command build
go build -ldflags="-s -w" -o /Users/mike/.mshell/mshell main-mshell.go
```

```bash
# @scripthaus command fullbuild
go build -ldflags="-s -w" -o /Users/mike/.mshell/mshell main-mshell.go
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /opt/mshell/bin/mshell.linux.amd64 main-mshell.go
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o /opt/mshell/bin/mshell.linux.arm64 main-mshell.go
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o /opt/mshell/bin/mshell.darwin.amd64 main-mshell.go
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o /opt/mshell/bin/mshell.darwin.arm64 main-mshell.go
```


