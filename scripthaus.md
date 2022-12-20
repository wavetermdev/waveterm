# SH2 Server Commands

```bash
# @scripthaus command dump-schema
sqlite3 /Users/mike/prompt/prompt.db .schema > db/schema.sql
```

```bash
# @scripthaus command opendb
sqlite3 /Users/mike/prompt/prompt.db
```

```bash
# @scripthaus command build
go build -o ~/prompt/local-server cmd/main-server.go
```
