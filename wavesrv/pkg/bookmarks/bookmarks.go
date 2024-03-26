package bookmarks

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type BookmarkType struct {
	BookmarkId  string   `json:"bookmarkid"`
	CreatedTs   int64    `json:"createdts"`
	CmdStr      string   `json:"cmdstr"`
	Alias       string   `json:"alias,omitempty"`
	Tags        []string `json:"tags"`
	Description string   `json:"description"`
	OrderIdx    int64    `json:"orderidx"`
	Remove      bool     `json:"remove,omitempty"`
}

func (bm *BookmarkType) GetSimpleKey() string {
	return bm.BookmarkId
}

func (bm *BookmarkType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["bookmarkid"] = bm.BookmarkId
	rtn["createdts"] = bm.CreatedTs
	rtn["cmdstr"] = bm.CmdStr
	rtn["alias"] = bm.Alias
	rtn["description"] = bm.Description
	rtn["tags"] = dbutil.QuickJsonArr(bm.Tags)
	return rtn
}

func (bm *BookmarkType) FromMap(m map[string]interface{}) bool {
	dbutil.QuickSetStr(&bm.BookmarkId, m, "bookmarkid")
	dbutil.QuickSetInt64(&bm.CreatedTs, m, "createdts")
	dbutil.QuickSetStr(&bm.Alias, m, "alias")
	dbutil.QuickSetStr(&bm.CmdStr, m, "cmdstr")
	dbutil.QuickSetStr(&bm.Description, m, "description")
	dbutil.QuickSetJsonArr(&bm.Tags, m, "tags")
	return true
}

type bookmarkOrderType struct {
	BookmarkId string
	OrderIdx   int64
}

func GetBookmarks(ctx context.Context, tag string) ([]*BookmarkType, error) {
	var bms []*BookmarkType
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		var query string
		if tag == "" {
			query = `SELECT * FROM bookmark`
			bms = dbutil.SelectMapsGen[*BookmarkType](tx, query)
		} else {
			query = `SELECT * FROM bookmark WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`
			bms = dbutil.SelectMapsGen[*BookmarkType](tx, query, tag)
		}
		bmMap := dbutil.MakeGenMap(bms)
		var orders []bookmarkOrderType
		query = `SELECT bookmarkid, orderidx FROM bookmark_order WHERE tag = ?`
		tx.Select(&orders, query, tag)
		for _, bmOrder := range orders {
			bm := bmMap[bmOrder.BookmarkId]
			if bm != nil {
				bm.OrderIdx = bmOrder.OrderIdx
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return bms, nil
}

func GetBookmarkById(ctx context.Context, bookmarkId string, tag string) (*BookmarkType, error) {
	var rtn *BookmarkType
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `SELECT * FROM bookmark WHERE bookmarkid = ?`
		rtn = dbutil.GetMapGen[*BookmarkType](tx, query, bookmarkId)
		if rtn == nil {
			return nil
		}
		query = `SELECT orderidx FROM bookmark_order WHERE bookmarkid = ? AND tag = ?`
		orderIdx := tx.GetInt(query, bookmarkId, tag)
		rtn.OrderIdx = int64(orderIdx)
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return rtn, nil
}

func GetBookmarkIdByArg(ctx context.Context, bookmarkArg string) (string, error) {
	var rtnId string
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		if len(bookmarkArg) == 8 {
			query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid LIKE (? || '%')`
			rtnId = tx.GetString(query, bookmarkArg)
			return nil
		}
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		rtnId = tx.GetString(query, bookmarkArg)
		return nil
	})
	if txErr != nil {
		return "", txErr
	}
	return rtnId, nil
}

func GetBookmarkIdsByCmdStr(ctx context.Context, cmdStr string) ([]string, error) {
	return sstore.WithTxRtn(ctx, func(tx *sstore.TxWrap) ([]string, error) {
		query := `SELECT bookmarkid FROM bookmark WHERE cmdstr = ?`
		bmIds := tx.SelectStrings(query, cmdStr)
		return bmIds, nil
	})
}

// ignores OrderIdx field
func InsertBookmark(ctx context.Context, bm *BookmarkType) error {
	if bm == nil || bm.BookmarkId == "" {
		return fmt.Errorf("invalid empty bookmark id")
	}
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if tx.Exists(query, bm.BookmarkId) {
			return fmt.Errorf("bookmarkid already exists")
		}
		query = `INSERT INTO bookmark ( bookmarkid, createdts, cmdstr, alias, tags, description)
                               VALUES (:bookmarkid,:createdts,:cmdstr,:alias,:tags,:description)`
		tx.NamedExec(query, bm.ToMap())
		for _, tag := range append(bm.Tags, "") {
			query = `SELECT COALESCE(max(orderidx), 0) FROM bookmark_order WHERE tag = ?`
			maxOrder := tx.GetInt(query, tag)
			query = `INSERT INTO bookmark_order (tag, bookmarkid, orderidx) VALUES (?, ?, ?)`
			tx.Exec(query, tag, bm.BookmarkId, maxOrder+1)
		}
		return nil
	})
	return txErr
}

const (
	BookmarkField_Desc   = "desc"
	BookmarkField_CmdStr = "cmdstr"
)

func EditBookmark(ctx context.Context, bookmarkId string, editMap map[string]interface{}) error {
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if !tx.Exists(query, bookmarkId) {
			return fmt.Errorf("bookmark not found")
		}
		if desc, found := editMap[BookmarkField_Desc]; found {
			query = `UPDATE bookmark SET description = ? WHERE bookmarkid = ?`
			tx.Exec(query, desc, bookmarkId)
		}
		if cmdStr, found := editMap[BookmarkField_CmdStr]; found {
			query = `UPDATE bookmark SET cmdstr = ? WHERE bookmarkid = ?`
			tx.Exec(query, cmdStr, bookmarkId)
		}
		return nil
	})
	return txErr
}

func fixupBookmarkOrder(tx *sstore.TxWrap) {
	query := `
WITH new_order AS (
  SELECT tag, bookmarkid, row_number() OVER (PARTITION BY tag ORDER BY orderidx) AS newidx FROM bookmark_order
)
UPDATE bookmark_order
SET orderidx = new_order.newidx
FROM new_order
WHERE bookmark_order.tag = new_order.tag AND bookmark_order.bookmarkid = new_order.bookmarkid
`
	tx.Exec(query)
}

func DeleteBookmark(ctx context.Context, bookmarkId string) error {
	txErr := sstore.WithTx(ctx, func(tx *sstore.TxWrap) error {
		query := `SELECT bookmarkid FROM bookmark WHERE bookmarkid = ?`
		if !tx.Exists(query, bookmarkId) {
			return fmt.Errorf("bookmark not found")
		}
		query = `DELETE FROM bookmark WHERE bookmarkid = ?`
		tx.Exec(query, bookmarkId)
		query = `DELETE FROM bookmark_order WHERE bookmarkid = ?`
		tx.Exec(query, bookmarkId)
		fixupBookmarkOrder(tx)
		return nil
	})
	return txErr
}
