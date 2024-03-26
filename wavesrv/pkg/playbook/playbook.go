// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package playbook

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type PlaybookType struct {
	PlaybookId   string   `json:"playbookid"`
	PlaybookName string   `json:"playbookname"`
	Description  string   `json:"description"`
	EntryIds     []string `json:"entryids"`

	// this is not persisted to DB, just for transport to FE
	Entries []*PlaybookEntry `json:"entries"`
}

func (p *PlaybookType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["playbookid"] = p.PlaybookId
	rtn["playbookname"] = p.PlaybookName
	rtn["description"] = p.Description
	rtn["entryids"] = dbutil.QuickJsonArr(p.EntryIds)
	return rtn
}

func (p *PlaybookType) FromMap(m map[string]interface{}) bool {
	dbutil.QuickSetStr(&p.PlaybookId, m, "playbookid")
	dbutil.QuickSetStr(&p.PlaybookName, m, "playbookname")
	dbutil.QuickSetStr(&p.Description, m, "description")
	dbutil.QuickSetJsonArr(&p.Entries, m, "entries")
	return true
}

// reorders p.Entries to match p.EntryIds
func (p *PlaybookType) OrderEntries() {
	if len(p.Entries) == 0 {
		return
	}
	m := make(map[string]*PlaybookEntry)
	for _, entry := range p.Entries {
		m[entry.EntryId] = entry
	}
	newList := make([]*PlaybookEntry, 0, len(p.EntryIds))
	for _, entryId := range p.EntryIds {
		entry := m[entryId]
		if entry != nil {
			newList = append(newList, entry)
		}
	}
	p.Entries = newList
}

// removes from p.EntryIds (not from p.Entries)
func (p *PlaybookType) RemoveEntry(entryIdToRemove string) {
	if len(p.EntryIds) == 0 {
		return
	}
	newList := make([]string, 0, len(p.EntryIds)-1)
	for _, entryId := range p.EntryIds {
		if entryId == entryIdToRemove {
			continue
		}
		newList = append(newList, entryId)
	}
	p.EntryIds = newList
}

type PlaybookEntry struct {
	PlaybookId  string `json:"playbookid"`
	EntryId     string `json:"entryid"`
	Alias       string `json:"alias"`
	CmdStr      string `json:"cmdstr"`
	UpdatedTs   int64  `json:"updatedts"`
	CreatedTs   int64  `json:"createdts"`
	Description string `json:"description"`
	Remove      bool   `json:"remove,omitempty"`
}

func CreatePlaybook(ctx context.Context, name string) (*PlaybookType, error) {
	return sstore.WithTxRtn(ctx, func(tx *sstore.TxWrap) (*PlaybookType, error) {
		query := `SELECT playbookid FROM playbook WHERE name = ?`
		if tx.Exists(query, name) {
			return nil, fmt.Errorf("playbook %q already exists", name)
		}
		rtn := &PlaybookType{}
		rtn.PlaybookId = uuid.New().String()
		rtn.PlaybookName = name
		query = `INSERT INTO playbook ( playbookid, playbookname, description, entryids)
                               VALUES (:playbookid,:playbookname,:description,:entryids)`
		tx.Exec(query, rtn.ToMap())
		return rtn, nil
	})
}

func selectPlaybook(tx *sstore.TxWrap, playbookId string) *PlaybookType {
	query := `SELECT * FROM playbook where playbookid = ?`
	playbook := dbutil.GetMapGen[*PlaybookType](tx, query, playbookId)
	return playbook
}

func AddPlaybookEntry(ctx context.Context, entry *PlaybookEntry) error {
	if entry.EntryId == "" {
		return fmt.Errorf("invalid entryid")
	}
	return sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		playbook := selectPlaybook(tx, entry.PlaybookId)
		if playbook == nil {
			return fmt.Errorf("cannot add entry, playbook does not exist")
		}
		query := `SELECT entryid FROM playbook_entry WHERE entryid = ?`
		if tx.Exists(query, entry.EntryId) {
			return fmt.Errorf("cannot add entry, entryid already exists")
		}
		query = `INSERT INTO playbook_entry ( entryid, playbookid, description, alias, cmdstr, createdts, updatedts)
                                     VALUES (:entryid,:playbookid,:description,:alias,:cmdstr,:createdts,:updatedts)`
		tx.Exec(query, entry)
		playbook.EntryIds = append(playbook.EntryIds, entry.EntryId)
		query = `UPDATE playbook SET entryids = ? WHERE playbookid = ?`
		tx.Exec(query, dbutil.QuickJsonArr(playbook.EntryIds), entry.PlaybookId)
		return nil
	})
}

func RemovePlaybookEntry(ctx context.Context, playbookId string, entryId string) error {
	return sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		playbook := selectPlaybook(tx, playbookId)
		if playbook == nil {
			return fmt.Errorf("cannot remove playbook entry, playbook does not exist")
		}
		query := `SELECT entryid FROM playbook_entry WHERE entryid = ?`
		if !tx.Exists(query, entryId) {
			return fmt.Errorf("cannot remove playbook entry, entry does not exist")
		}
		query = `DELETE FROM playbook_entry WHERE entryid = ?`
		tx.Exec(query, entryId)
		playbook.RemoveEntry(entryId)
		query = `UPDATE playbook SET entryids = ? WHERE playbookid = ?`
		tx.Exec(query, dbutil.QuickJsonArr(playbook.EntryIds), playbookId)
		return nil
	})
}

func GetPlaybookById(ctx context.Context, playbookId string) (*PlaybookType, error) {
	return sstore.WithTxRtn(ctx, func(tx *sstore.TxWrap) (*PlaybookType, error) {
		rtn := selectPlaybook(tx, playbookId)
		if rtn == nil {
			return nil, nil
		}
		query := `SELECT * FROM playbook_entry WHERE playbookid = ?`
		tx.Select(&rtn.Entries, query, playbookId)
		rtn.OrderEntries()
		return rtn, nil
	})
}
