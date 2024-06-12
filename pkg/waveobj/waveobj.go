// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sync"

	"github.com/mitchellh/mapstructure"
)

const (
	OTypeKeyName   = "otype"
	OIDKeyName     = "oid"
	VersionKeyName = "version"
	MetaKeyName    = "meta"

	OIDGoFieldName     = "OID"
	VersionGoFieldName = "Version"
	MetaGoFieldName    = "Meta"
)

type ORef struct {
	OType string `json:"otype" mapstructure:"otype"`
	OID   string `json:"oid" mapstructure:"oid"`
}

func (oref ORef) String() string {
	return fmt.Sprintf("%s:%s", oref.OType, oref.OID)
}

func MakeORef(otype string, oid string) ORef {
	return ORef{
		OType: otype,
		OID:   oid,
	}
}

type WaveObj interface {
	GetOType() string // should not depend on object state (should work with nil value)
}

type waveObjDesc struct {
	RType        reflect.Type
	OIDField     reflect.StructField
	VersionField reflect.StructField
	MetaField    reflect.StructField
}

var waveObjMap = sync.Map{}
var waveObjRType = reflect.TypeOf((*WaveObj)(nil)).Elem()

func RegisterType(rtype reflect.Type) {
	if rtype.Kind() != reflect.Ptr {
		panic(fmt.Sprintf("wave object must be a pointer for %v", rtype))
	}
	if !rtype.Implements(waveObjRType) {
		panic(fmt.Sprintf("wave object must implement WaveObj for %v", rtype))
	}
	waveObj := reflect.Zero(rtype).Interface().(WaveObj)
	otype := waveObj.GetOType()
	if otype == "" {
		panic(fmt.Sprintf("otype is empty for %v", rtype))
	}
	oidField, found := rtype.Elem().FieldByName(OIDGoFieldName)
	if !found {
		panic(fmt.Sprintf("missing OID field for %v", rtype))
	}
	if oidField.Type.Kind() != reflect.String {
		panic(fmt.Sprintf("OID field must be string for %v", rtype))
	}
	if oidField.Tag.Get("json") != OIDKeyName {
		panic(fmt.Sprintf("OID field json tag must be %q for %v", OIDKeyName, rtype))
	}
	versionField, found := rtype.Elem().FieldByName(VersionGoFieldName)
	if !found {
		panic(fmt.Sprintf("missing Version field for %v", rtype))
	}
	if versionField.Type.Kind() != reflect.Int {
		panic(fmt.Sprintf("Version field must be int for %v", rtype))
	}
	if versionField.Tag.Get("json") != VersionKeyName {
		panic(fmt.Sprintf("Version field json tag must be %q for %v", VersionKeyName, rtype))
	}
	metaField, found := rtype.Elem().FieldByName(MetaGoFieldName)
	if !found {
		panic(fmt.Sprintf("missing Meta field for %v", rtype))
	}
	if metaField.Type.Kind() != reflect.Map ||
		metaField.Type.Elem().Kind() != reflect.Interface ||
		metaField.Type.Key().Kind() != reflect.String {
		panic(fmt.Sprintf("Meta field must be map[string]any for %v", rtype))
	}
	_, found = waveObjMap.Load(otype)
	if found {
		panic(fmt.Sprintf("otype %q already registered", otype))
	}
	waveObjMap.Store(otype, &waveObjDesc{
		RType:        rtype,
		OIDField:     oidField,
		VersionField: versionField,
		MetaField:    metaField,
	})
}

func getWaveObjDesc(otype string) *waveObjDesc {
	desc, _ := waveObjMap.Load(otype)
	if desc == nil {
		return nil
	}
	return desc.(*waveObjDesc)
}

func GetOID(waveObj WaveObj) string {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return ""
	}
	return reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.OIDField.Index).String()
}

func SetOID(waveObj WaveObj, oid string) {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return
	}
	reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.OIDField.Index).SetString(oid)
}

func GetVersion(waveObj WaveObj) int {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return 0
	}
	return int(reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.VersionField.Index).Int())
}

func SetVersion(waveObj WaveObj, version int) {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return
	}
	reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.VersionField.Index).SetInt(int64(version))
}

func GetMeta(waveObj WaveObj) map[string]any {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return nil
	}
	return reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.MetaField.Index).Interface().(map[string]any)
}

func SetMeta(waveObj WaveObj, meta map[string]any) {
	desc := getWaveObjDesc(waveObj.GetOType())
	if desc == nil {
		return
	}
	reflect.ValueOf(waveObj).Elem().FieldByIndex(desc.MetaField.Index).Set(reflect.ValueOf(meta))
}

func DoMapStucture(out any, input any) error {
	dconfig := &mapstructure.DecoderConfig{
		Result:  out,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return err
	}
	return decoder.Decode(input)
}

func ToJsonMap(w WaveObj) (map[string]any, error) {
	if w == nil {
		return nil, nil
	}
	m := make(map[string]any)
	dconfig := &mapstructure.DecoderConfig{
		Result:  &m,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return nil, err
	}
	err = decoder.Decode(w)
	if err != nil {
		return nil, err
	}
	m[OTypeKeyName] = w.GetOType()
	m[OIDKeyName] = GetOID(w)
	m[VersionKeyName] = GetVersion(w)
	return m, nil
}

func ToJson(w WaveObj) ([]byte, error) {
	m, err := ToJsonMap(w)
	if err != nil {
		return nil, err
	}
	return json.Marshal(m)
}

func FromJson(data []byte) (WaveObj, error) {
	var m map[string]any
	err := json.Unmarshal(data, &m)
	if err != nil {
		return nil, err
	}
	return FromJsonMap(m)
}

func FromJsonMap(m map[string]any) (WaveObj, error) {
	otype, ok := m[OTypeKeyName].(string)
	if !ok {
		return nil, fmt.Errorf("missing otype")
	}
	desc := getWaveObjDesc(otype)
	if desc == nil {
		return nil, fmt.Errorf("unknown otype: %s", otype)
	}
	wobj := reflect.Zero(desc.RType).Interface().(WaveObj)
	dconfig := &mapstructure.DecoderConfig{
		Result:  &wobj,
		TagName: "json",
	}
	decoder, err := mapstructure.NewDecoder(dconfig)
	if err != nil {
		return nil, err
	}
	err = decoder.Decode(m)
	if err != nil {
		return nil, err
	}
	return wobj, nil
}

func ORefFromMap(m map[string]any) (*ORef, error) {
	oref := ORef{}
	err := mapstructure.Decode(m, &oref)
	if err != nil {
		return nil, err
	}
	return &oref, nil
}

func ORefFromWaveObj(w WaveObj) *ORef {
	return &ORef{
		OType: w.GetOType(),
		OID:   GetOID(w),
	}
}

func FromJsonGen[T WaveObj](data []byte) (T, error) {
	obj, err := FromJson(data)
	if err != nil {
		var zero T
		return zero, err
	}
	rtn, ok := obj.(T)
	if !ok {
		var zero T
		return zero, fmt.Errorf("type mismatch got %T, expected %T", obj, zero)
	}
	return rtn, nil
}
