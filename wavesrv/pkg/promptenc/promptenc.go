// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package promptenc

import (
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"reflect"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
	ccp "golang.org/x/crypto/chacha20poly1305"
)

const EncTagName = "enc"
const EncFieldIndicator = "*"

type Encryptor struct {
	Key  []byte
	AEAD cipher.AEAD
}

type HasOData interface {
	GetOData() string
}

func readRandBytes(n int) ([]byte, error) {
	rtn := make([]byte, n)
	_, err := io.ReadFull(rand.Reader, rtn)
	return rtn, err
}

func MakeRandomEncryptor() (*Encryptor, error) {
	key, err := readRandBytes(ccp.KeySize)
	if err != nil {
		return nil, err
	}
	rtn := &Encryptor{Key: key}
	rtn.AEAD, err = ccp.NewX(rtn.Key)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func MakeEncryptor(key []byte) (*Encryptor, error) {
	var err error
	rtn := &Encryptor{Key: key}
	rtn.AEAD, err = ccp.NewX(rtn.Key)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func MakeEncryptorB64(key64 string) (*Encryptor, error) {
	keyBytes, err := base64.RawURLEncoding.DecodeString(key64)
	if err != nil {
		return nil, err
	}
	return MakeEncryptor(keyBytes)
}

func (enc *Encryptor) EncryptData(plainText []byte, odata string) ([]byte, error) {
	bufSize, err := utilfn.AddIntSlice(enc.AEAD.NonceSize(), enc.AEAD.Overhead(), len(plainText))
	if err != nil {
		return nil, err
	}
	outputBuf := make([]byte, bufSize)
	nonce := outputBuf[0:enc.AEAD.NonceSize()]
	_, err = io.ReadFull(rand.Reader, nonce)
	if err != nil {
		return nil, err
	}
	// we're going to append the cipherText to nonce.  so the encrypted data is [nonce][ciphertext]
	// note that outputbuf should be the correct size to hold the rtn value
	rtn := enc.AEAD.Seal(nonce, nonce, plainText, []byte(odata))
	return rtn, nil
}

func (enc *Encryptor) DecryptData(encData []byte, odata string) (map[string]interface{}, error) {
	minLen := enc.AEAD.NonceSize() + enc.AEAD.Overhead()
	if len(encData) < minLen {
		return nil, fmt.Errorf("invalid encdata, len:%d is less than minimum len:%d", len(encData), minLen)
	}
	m := make(map[string]interface{})
	nonce := encData[0:enc.AEAD.NonceSize()]
	cipherText := encData[enc.AEAD.NonceSize():]
	plainText, err := enc.AEAD.Open(nil, nonce, cipherText, []byte(odata))
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(plainText, &m)
	if err != nil {
		return nil, err
	}
	return m, nil
}

type EncryptMeta struct {
	EncField    *reflect.StructField
	PlainFields map[string]reflect.StructField
}

func isByteArrayType(t reflect.Type) bool {
	return t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.Uint8
}

func metaFromType(v interface{}) (*EncryptMeta, error) {
	if v == nil {
		return nil, fmt.Errorf("Encryptor cannot encrypt nil")
	}
	rt := reflect.TypeOf(v)
	if rt.Kind() != reflect.Pointer {
		return nil, fmt.Errorf("Encryptor invalid type %T, not a pointer type", v)
	}
	rtElem := rt.Elem()
	if rtElem.Kind() != reflect.Struct {
		return nil, fmt.Errorf("Encryptor invalid type %T, not a pointer to struct type", v)
	}
	meta := &EncryptMeta{}
	meta.PlainFields = make(map[string]reflect.StructField)
	numFields := rtElem.NumField()
	for i := 0; i < numFields; i++ {
		field := rtElem.Field(i)
		encTag := field.Tag.Get(EncTagName)
		if encTag == "" {
			continue
		}
		if encTag == EncFieldIndicator {
			if meta.EncField != nil {
				return nil, fmt.Errorf("Encryptor, type %T has two enc fields set (*)", v)
			}
			if !isByteArrayType(field.Type) {
				return nil, fmt.Errorf("Encryptor, type %T enc field %q is not []byte", v, field.Name)
			}
			meta.EncField = &field
			continue
		}
		if _, found := meta.PlainFields[encTag]; found {
			return nil, fmt.Errorf("Encryptor, type %T has two enc fields with tag %q", v, encTag)
		}
		meta.PlainFields[encTag] = field
	}
	if meta.EncField == nil {
		return nil, fmt.Errorf("Encryptor, type %T has no enc (*) field", v)
	}
	return meta, nil
}

func (enc *Encryptor) EncryptODS(v HasOData) error {
	odata := v.GetOData()
	return enc.EncryptStructFields(v, odata)
}

func (enc *Encryptor) DecryptODS(v HasOData) error {
	odata := v.GetOData()
	return enc.DecryptStructFields(v, odata)
}

func (enc *Encryptor) EncryptStructFields(v interface{}, odata string) error {
	encMeta, err := metaFromType(v)
	if err != nil {
		return err
	}
	rvPtr := reflect.ValueOf(v)
	rv := rvPtr.Elem()
	m := make(map[string]interface{})
	for jsonKey, field := range encMeta.PlainFields {
		fieldVal := rv.FieldByIndex(field.Index)
		m[jsonKey] = fieldVal.Interface()
	}
	barr, err := json.Marshal(m)
	if err != nil {
		return err
	}
	cipherText, err := enc.EncryptData(barr, odata)
	if err != nil {
		return err
	}
	encFieldValue := rv.FieldByIndex(encMeta.EncField.Index)
	encFieldValue.SetBytes(cipherText)
	return nil
}

func (enc *Encryptor) DecryptStructFields(v interface{}, odata string) error {
	encMeta, err := metaFromType(v)
	if err != nil {
		return err
	}
	rvPtr := reflect.ValueOf(v)
	rv := rvPtr.Elem()
	cipherText := rv.FieldByIndex(encMeta.EncField.Index).Bytes()
	m, err := enc.DecryptData(cipherText, odata)
	if err != nil {
		return err
	}
	for jsonKey, field := range encMeta.PlainFields {
		val := m[jsonKey]
		rv.FieldByIndex(field.Index).Set(reflect.ValueOf(val))
	}
	return nil
}
