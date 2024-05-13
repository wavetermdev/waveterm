// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func initDb(t *testing.T) {
	t.Logf("initializing db for %q", t.Name())
	useTestingDb = true
	partDataSize = 64
	err := MigrateBlockstore(false)
	if err != nil {
		t.Fatalf("error migrating blockstore: %v", err)
	}
}

func cleanupDb(t *testing.T) {
	t.Logf("cleaning up db for %q", t.Name())
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB != nil {
		globalDB.Close()
		globalDB = nil
	}
	globalDBErr = nil
	useTestingDb = false
	partDataSize = DefaultPartDataSize
}

func TestCreate(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	err := GBS.MakeFile(ctx, blockId, "testfile", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	file, err := GBS.Stat(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	if file.BlockId != blockId {
		t.Fatalf("block id mismatch")
	}
	if file.Name != "testfile" {
		t.Fatalf("name mismatch")
	}
	if file.Size != 0 {
		t.Fatalf("size mismatch")
	}
	if file.CreatedTs == 0 {
		t.Fatalf("created ts zero")
	}
	if file.ModTs == 0 {
		t.Fatalf("mod ts zero")
	}
	if file.CreatedTs != file.ModTs {
		t.Fatalf("create ts != mod ts")
	}
	if len(file.Meta) != 0 {
		t.Fatalf("meta should have no values")
	}
	if file.Opts.Circular || file.Opts.IJson || file.Opts.MaxSize != 0 {
		t.Fatalf("opts not empty")
	}
}
