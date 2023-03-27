package sstore

import (
	"context"
)

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (RT, error) {
	var rtn RT
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		temp, err := fn(tx)
		if err != nil {
			return err
		}
		rtn = temp
		return nil
	})
	return rtn, txErr
}

func WithTxRtn3[RT1 any, RT2 any](ctx context.Context, fn func(tx *TxWrap) (RT1, RT2, error)) (RT1, RT2, error) {
	var rtn1 RT1
	var rtn2 RT2
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		temp1, temp2, err := fn(tx)
		if err != nil {
			return err
		}
		rtn1 = temp1
		rtn2 = temp2
		return nil
	})
	return rtn1, rtn2, txErr
}
