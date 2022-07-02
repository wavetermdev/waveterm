# SH2 Server Commands

```bash
# @scripthaus command dump-schema
sqlite3 /Users/mike/scripthaus/sh2.db .schema > db/schema.sql
```

```bash
# @scripthaus command opendb
sqlite3 /Users/mike/scripthaus/sh2.db
```

```bash
# @scripthaus command build
go build -o server cmd/main-server.go
```
