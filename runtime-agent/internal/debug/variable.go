// Package debug — variable inspection logic over JDWP.
//
// Implements parsing of JDWP variable responses and provides
// structured representations of local variables, fields, array
// elements, and object references. Supports primitive types,
// strings, arrays, and objects with nested reference handling.
package debug

import (
	"fmt"
	"strings"
)

// VariableKind classifies a debug variable.
type VariableKind string

const (
	VarKindPrimitive VariableKind = "primitive"
	VarKindString    VariableKind = "string"
	VarKindArray     VariableKind = "array"
	VarKindObject    VariableKind = "object"
	VarKindNull      VariableKind = "null"
	VarKindThread    VariableKind = "thread"
	VarKindUnknown   VariableKind = "unknown"
)

// Variable represents a single debug variable (local, field, or
// array element) as returned by the JVM via JDWP.
type Variable struct {
	Name        string       `json:"name"`
	Value       string       `json:"value"`
	TypeName    string       `json:"typeName"`
	Kind        VariableKind `json:"kind"`
	Tag         byte         `json:"-"` // raw JDWP tag
	ObjectID    int64        `json:"-"` // non-zero for reference types
	ArrayLength int32        `json:"-"` // non-zero for arrays
	HasChildren bool         `json:"hasChildren"`
	Children    []*Variable  `json:"children,omitempty"`
}

// VariableList is a list of variables with convenience methods.
type VariableList struct {
	Variables []*Variable `json:"variables"`
	Count     int         `json:"count"`
}

// MaxStringDisplayLen is the maximum length of a string value
// before it is truncated for display.
const MaxStringDisplayLen = 256

// MaxArraySummaryLen is the maximum number of array elements
// shown in a summary string.
const MaxArraySummaryLen = 10

// ParseVariableList parses a JDWP StackFrame GetValues reply
// containing a list of tagged values.
//
// Reply format:
//
//	[int: count]
//	[for each slot:
//	  byte: slot
//	  byte: tag
//	  value]
func ParseVariableList(data []byte, names []string, signatures []string) (*VariableList, error) {
	r := NewJDWPDataReader(data)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse variable count: %w", err)
	}

	result := &VariableList{
		Variables: make([]*Variable, 0, count),
		Count:     int(count),
	}

	for i := int32(0); i < count; i++ {
		// Read slot index (we ignore it since we use positional names)
		if _, err := r.ReadInt(); err != nil {
			return nil, fmt.Errorf("parse variable slot %d: %w", i, err)
		}

		tag, err := r.ReadByte()
		if err != nil {
			return nil, fmt.Errorf("parse variable tag %d: %w", i, err)
		}

		v, err := parseVariableFromTag(r, tag)
		if err != nil {
			return nil, fmt.Errorf("parse variable %d: %w", i, err)
		}

		if v != nil {
			if i < int32(len(names)) {
				v.Name = names[i]
			} else {
				v.Name = fmt.Sprintf("var%d", i)
			}
			if i < int32(len(signatures)) {
				v.TypeName = jdwpSignatureToTypeName(signatures[i])
			}
			result.Variables = append(result.Variables, v)
		}
	}

	return result, nil
}

// ParseFieldList parses a JDWP ObjectReference/ReferenceType
// GetValues reply for fields.
//
// Reply format:
//
//	[int: count]
//	[for each field:
//	  byte: tag
//	  value]
func ParseFieldList(data []byte, fieldNames []string, fieldSignatures []string) (*VariableList, error) {
	r := NewJDWPDataReader(data)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse field count: %w", err)
	}

	result := &VariableList{
		Variables: make([]*Variable, 0, count),
		Count:     int(count),
	}

	for i := int32(0); i < count; i++ {
		tag, err := r.ReadByte()
		if err != nil {
			return nil, fmt.Errorf("parse field tag %d: %w", i, err)
		}

		v, err := parseVariableFromTag(r, tag)
		if err != nil {
			return nil, fmt.Errorf("parse field %d: %w", i, err)
		}

		if v != nil {
			if i < int32(len(fieldNames)) {
				v.Name = fieldNames[i]
			}
			if i < int32(len(fieldSignatures)) {
				v.TypeName = jdwpSignatureToTypeName(fieldSignatures[i])
			}
			result.Variables = append(result.Variables, v)
		}
	}

	return result, nil
}

// ParseArrayElements parses a JDWP ArrayReference GetValues reply.
//
// Reply format:
//
//	[byte: type tag]
//	[int: count]
//	[for each element:
//	  value (untagged)]
func ParseArrayElements(data []byte, arrayTypeTag byte, startIndex int32) (*VariableList, error) {
	r := NewJDWPDataReader(data)

	// Read the type tag echoed back
	_, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("parse array type tag: %w", err)
	}

	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse array element count: %w", err)
	}

	result := &VariableList{
		Variables: make([]*Variable, 0, count),
		Count:     int(count),
	}

	// Determine the element tag from the array type tag
	elemTag := arrayTypeToElementTag(arrayTypeTag)

	for i := int32(0); i < count; i++ {
		idx := startIndex + i
		v, err := parseVariableFromUntagged(r, elemTag)
		if err != nil {
			return nil, fmt.Errorf("parse array element %d: %w", idx, err)
		}
		if v != nil {
			v.Name = fmt.Sprintf("[%d]", idx)
			v.TypeName = jdwpTagToTypeName(elemTag)
			result.Variables = append(result.Variables, v)
		}
	}

	return result, nil
}

// ParseStringValue parses a JDWP StringReference Value reply.
//
// Reply format:
//
//	[string: value]
func ParseStringValue(data []byte) (string, error) {
	r := NewJDWPDataReader(data)
	return r.ReadString()
}

// parseVariableFromTag reads a tagged value and builds a Variable.
func parseVariableFromTag(r *JDWPDataReader, tag byte) (*Variable, error) {
	if tag == jdwpTagVoid {
		return nil, nil
	}

	v := &Variable{
		Tag:  tag,
		Kind: jdwpTagToKind(tag),
	}

	switch tag {
	case jdwpTagByte:
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		v.Value = fmt.Sprintf("%d", int8(b))
	case jdwpTagChar:
		val, err := r.ReadInt()
		if err != nil {
			return nil, err
		}
		v.Value = fmt.Sprintf("'%c' (0x%04x)", rune(uint16(val)), uint16(val))
	case jdwpTagDouble:
		val, err := r.ReadDouble()
		if err != nil {
			return nil, err
		}
		v.Value = formatDouble(val)
	case jdwpTagFloat:
		val, err := r.ReadFloat()
		if err != nil {
			return nil, err
		}
		v.Value = formatFloat(val)
	case jdwpTagInt:
		val, err := r.ReadInt()
		if err != nil {
			return nil, err
		}
		v.Value = formatInt(val)
	case jdwpTagLong:
		val, err := r.ReadLong()
		if err != nil {
			return nil, err
		}
		v.Value = formatLong(val)
	case jdwpTagShort:
		val, err := r.ReadInt()
		if err != nil {
			return nil, err
		}
		v.Value = fmt.Sprintf("%d", int16(val))
	case jdwpTagBoolean:
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		if b != 0 {
			v.Value = "true"
		} else {
			v.Value = "false"
		}
	case jdwpTagString:
		oid, err := r.ReadObjectID()
		if err != nil {
			return nil, err
		}
		v.ObjectID = oid
		v.Value = fmt.Sprintf("String@%d", oid)
		v.HasChildren = true
	case jdwpTagArray:
		oid, err := r.ReadObjectID()
		if err != nil {
			return nil, err
		}
		v.ObjectID = oid
		v.Value = "Array"
		v.HasChildren = true
	case jdwpTagObject, jdwpTagThread, jdwpTagThreadGroup,
		jdwpTagClassLoader, jdwpTagClassObject:
		oid, err := r.ReadObjectID()
		if err != nil {
			return nil, err
		}
		if oid == 0 {
			v.Kind = VarKindNull
			v.Value = "null"
		} else {
			v.ObjectID = oid
			v.Value = fmt.Sprintf("Object@%d", oid)
			v.HasChildren = true
		}
	default:
		return nil, fmt.Errorf("unknown variable tag: '%c' (0x%x)", tag, tag)
	}

	return v, nil
}

// parseVariableFromUntagged reads an untagged value and builds a Variable.
func parseVariableFromUntagged(r *JDWPDataReader, tag byte) (*Variable, error) {
	if tag == jdwpTagVoid {
		return nil, nil
	}

	v := &Variable{
		Tag:  tag,
		Kind: jdwpTagToKind(tag),
	}

	raw, err := r.ReadUntaggedValue(tag)
	if err != nil {
		return nil, err
	}

	switch tag {
	case jdwpTagByte:
		v.Value = fmt.Sprintf("%d", raw.(int8))
	case jdwpTagChar:
		val := raw.(uint16)
		v.Value = fmt.Sprintf("'%c' (0x%04x)", rune(val), val)
	case jdwpTagDouble:
		v.Value = formatDouble(raw.(float64))
	case jdwpTagFloat:
		v.Value = formatFloat(raw.(float32))
	case jdwpTagInt:
		v.Value = formatInt(raw.(int32))
	case jdwpTagLong:
		v.Value = formatLong(raw.(int64))
	case jdwpTagShort:
		v.Value = fmt.Sprintf("%d", raw.(int16))
	case jdwpTagBoolean:
		if raw.(bool) {
			v.Value = "true"
		} else {
			v.Value = "false"
		}
	case jdwpTagString, jdwpTagArray, jdwpTagObject, jdwpTagThread,
		jdwpTagThreadGroup, jdwpTagClassLoader, jdwpTagClassObject:
		oid := raw.(int64)
		if oid == 0 {
			v.Kind = VarKindNull
			v.Value = "null"
		} else {
			v.ObjectID = oid
			v.Value = fmt.Sprintf("Object@%d", oid)
			v.HasChildren = true
		}
	}

	return v, nil
}

// jdwpTagToKind maps a JDWP tag byte to a VariableKind.
func jdwpTagToKind(tag byte) VariableKind {
	switch tag {
	case jdwpTagByte, jdwpTagChar, jdwpTagDouble, jdwpTagFloat,
		jdwpTagInt, jdwpTagLong, jdwpTagShort, jdwpTagBoolean:
		return VarKindPrimitive
	case jdwpTagString:
		return VarKindString
	case jdwpTagArray:
		return VarKindArray
	case jdwpTagObject, jdwpTagThread, jdwpTagThreadGroup,
		jdwpTagClassLoader, jdwpTagClassObject:
		return VarKindObject
	default:
		return VarKindUnknown
	}
}

// jdwpTagToTypeName returns a human-readable type name for a tag.
func jdwpTagToTypeName(tag byte) string {
	switch tag {
	case jdwpTagByte:
		return "byte"
	case jdwpTagChar:
		return "char"
	case jdwpTagDouble:
		return "double"
	case jdwpTagFloat:
		return "float"
	case jdwpTagInt:
		return "int"
	case jdwpTagLong:
		return "long"
	case jdwpTagShort:
		return "short"
	case jdwpTagBoolean:
		return "boolean"
	case jdwpTagString:
		return "java.lang.String"
	case jdwpTagArray:
		return "array"
	case jdwpTagObject:
		return "java.lang.Object"
	case jdwpTagThread:
		return "java.lang.Thread"
	case jdwpTagThreadGroup:
		return "java.lang.ThreadGroup"
	case jdwpTagClassLoader:
		return "java.lang.ClassLoader"
	case jdwpTagClassObject:
		return "java.lang.Class"
	default:
		return "unknown"
	}
}

// jdwpSignatureToTypeName converts a JVM signature to a type name.
func jdwpSignatureToTypeName(sig string) string {
	if sig == "" {
		return ""
	}

	switch sig[0] {
	case 'B':
		return "byte"
	case 'C':
		return "char"
	case 'D':
		return "double"
	case 'F':
		return "float"
	case 'I':
		return "int"
	case 'J':
		return "long"
	case 'S':
		return "short"
	case 'Z':
		return "boolean"
	case 'V':
		return "void"
	case 'L':
		// Remove leading 'L' and trailing ';', replace '/' with '.'
		cls := sig[1:]
		if len(cls) > 0 && cls[len(cls)-1] == ';' {
			cls = cls[:len(cls)-1]
		}
		return strings.ReplaceAll(cls, "/", ".")
	case '[':
		// Array type — recursively get element type
		elemIdx := 1
		for elemIdx < len(sig) && sig[elemIdx] == '[' {
			elemIdx++
		}
		elemSig := sig[elemIdx:]
		return jdwpSignatureToTypeName(elemSig) + strings.Repeat("[]", elemIdx)
	default:
		return sig
	}
}

// arrayTypeToElementTag converts an array type tag to the element tag.
func arrayTypeToElementTag(arrayTag byte) byte {
	switch arrayTag {
	case jdwpTagArray:
		// The element type of an object array is Object
		return jdwpTagObject
	default:
		// For primitive arrays, the tag already represents the element type
		return arrayTag
	}
}

// FormatValue formats a raw value for display in the debugger UI.
func FormatValue(tag byte, raw interface{}) string {
	switch tag {
	case jdwpTagByte:
		if v, ok := raw.(int8); ok {
			return fmt.Sprintf("%d", v)
		}
	case jdwpTagShort:
		if v, ok := raw.(int16); ok {
			return fmt.Sprintf("%d", v)
		}
	case jdwpTagInt:
		if v, ok := raw.(int32); ok {
			return formatInt(v)
		}
	case jdwpTagLong:
		if v, ok := raw.(int64); ok {
			return formatLong(v)
		}
	case jdwpTagFloat:
		if v, ok := raw.(float32); ok {
			return formatFloat(v)
		}
	case jdwpTagDouble:
		if v, ok := raw.(float64); ok {
			return formatDouble(v)
		}
	case jdwpTagBoolean:
		if v, ok := raw.(bool); ok {
			if v {
				return "true"
			}
			return "false"
		}
	case jdwpTagChar:
		if v, ok := raw.(uint16); ok {
			return fmt.Sprintf("'%c'", rune(v))
		}
	case jdwpTagString:
		if v, ok := raw.(string); ok {
			return truncateString(v, MaxStringDisplayLen)
		}
	}
	return fmt.Sprintf("%v", raw)
}

// formatInt formats an int32 with hex representation.
func formatInt(v int32) string {
	return fmt.Sprintf("%d (0x%08x)", v, uint32(v))
}

// formatLong formats an int64 with hex representation.
func formatLong(v int64) string {
	return fmt.Sprintf("%d (0x%016x)", v, uint64(v))
}

// formatFloat formats a float32.
func formatFloat(v float32) string {
	return fmt.Sprintf("%g", v)
}

// formatDouble formats a float64.
func formatDouble(v float64) string {
	return fmt.Sprintf("%g", v)
}

// truncateString truncates a string to maxLen for display.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return "\"" + s + "\""
	}
	return fmt.Sprintf("\"%s\"... (%d chars total)", s[:maxLen], len(s))
}

// FormatArraySummary creates a summary string for an array.
func FormatArraySummary(arrayType string, length int32) string {
	return fmt.Sprintf("%s[%d]", arrayType, length)
}

// JDWP command builders for variable-related operations.

// BuildStackFrameGetValuesCommand builds a StackFrame.GetValues command.
func BuildStackFrameGetValuesCommand(threadID, frameID int64, slots []int32, tags []byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	w.WriteObjectID(frameID)
	w.WriteInt(int32(len(slots)))
	for _, slot := range slots {
		w.WriteInt(slot)
		w.WriteByte(tags[0]) // simplified: use same tag for all slots
	}
	return w.Bytes()
}

// BuildObjectReferenceGetValuesCommand builds an ObjectReference.GetValues command.
func BuildObjectReferenceGetValuesCommand(objectID int64, fieldIDs []int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(objectID)
	w.WriteInt(int32(len(fieldIDs)))
	for _, fid := range fieldIDs {
		w.WriteObjectID(fid)
	}
	return w.Bytes()
}

// BuildArrayReferenceGetValuesCommand builds an ArrayReference.GetValues command.
func BuildArrayReferenceGetValuesCommand(arrayID int64, firstIndex, length int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(arrayID)
	w.WriteInt(firstIndex)
	w.WriteInt(length)
	return w.Bytes()
}

// BuildStringReferenceValueCommand builds a StringReference.Value command.
func BuildStringReferenceValueCommand(objectID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(objectID)
	return w.Bytes()
}

// BuildArrayReferenceLengthCommand builds an ArrayReference.Length command.
func BuildArrayReferenceLengthCommand(arrayID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(arrayID)
	return w.Bytes()
}