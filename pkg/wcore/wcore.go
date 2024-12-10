// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave core application coordinator
package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the wcore package coordinates actions across the storage layer
// orchestrating the wave object store, the wave pubsub system, and the wave rpc system

// Ensures that the initial data is present in the store, creates an initial window if needed
func EnsureInitialData() error {
	// does not need to run in a transaction since it is called on startup
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err == wstore.ErrNotFound {
		client, err = CreateClient(ctx)
		if err != nil {
			return fmt.Errorf("error creating client: %w", err)
		}
		migrateErr := wstore.TryMigrateOldHistory()
		if migrateErr != nil {
			log.Printf("error migrating old history: %v\n", migrateErr)
		}
	}
	if client.TempOID == "" {
		log.Println("client.TempOID is empty")
		client.TempOID = uuid.NewString()
		err = wstore.DBUpdate(ctx, client)
		if err != nil {
			return fmt.Errorf("error updating client: %w", err)
		}
	}
	log.Printf("clientid: %s\n", client.OID)
	if len(client.WindowIds) == 1 {
		log.Println("client has one window")
		CheckAndFixWindow(ctx, client.WindowIds[0])
		return nil
	}
	if len(client.WindowIds) > 0 {
		log.Println("client has windows")
		return nil
	}
	log.Println("client has no windows, creating starter workspace")
	starterWs, err := CreateWorkspace(ctx, "Starter workspace", "circle", "#58C142", true)
	if err != nil {
		return fmt.Errorf("error creating starter workspace: %w", err)
	}
	_, err = CreateWindow(ctx, nil, starterWs.OID)
	if err != nil {
		return fmt.Errorf("error creating window: %w", err)
	}
	return nil
}

func CreateClient(ctx context.Context) (*waveobj.Client, error) {
	client := &waveobj.Client{
		OID:       uuid.NewString(),
		WindowIds: []string{},
	}
	err := wstore.DBInsert(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error inserting client: %w", err)
	}
	return client, nil
}

func GetClientData(ctx context.Context) (*waveobj.Client, error) {
	clientData, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	return clientData, nil
}
