# Local Patch for golang.org/x/crypto

## Why this exists

This is a local copy of `golang.org/x/crypto v0.52.0` with patches for
[golang/go#79658](https://github.com/golang/go/issues/79658): drain loops in
`ssh/mux.go` and `ssh/channel.go` spin forever on closed channels, causing
100%+ CPU after SSH disconnect.

## Patches Applied

1. **ssh/mux.go** — `SendRequest` drain loop (commit 4c4d20b upstream):
   ```go
   // Before (buggy):
   case <-m.globalResponses:
   
   // After (fixed):
   case _, ok := <-m.globalResponses:
       if !ok {
           break drain
       }
   ```

2. **ssh/channel.go** — `SendRequest` drain loop (commit e3e62d9 upstream):
   ```go
   // Before (buggy):
   case <-ch.msg:
   
   // After (fixed):
   case _, ok := <-ch.msg:
       if !ok {
           break drain
       }
   ```

## Rollback

**Remove the `replace` directive in `go.mod` and delete this directory when
upgrading to `golang.org/x/crypto >= v0.53.0`**, which will include both fixes.

The go.mod replace directive:
```
replace golang.org/x/crypto v0.52.0 => ./local_crypto_patch/contents
```