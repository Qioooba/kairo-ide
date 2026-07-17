package toolchain

import (
	"encoding/json"
	"io"
	"regexp"
)

func jsonUnmarshal(data []byte, v any) error  { return json.Unmarshal(data, v) }
func jsonMarshal(v any) ([]byte, error)        { return json.Marshal(v) }
func copyAll(dst io.Writer, src io.Reader) (int64, error) { return io.Copy(dst, src) }

var (
	regexpCompile = regexp.MustCompile
	supportedVersionsRE = regexp.MustCompile(`(?m)\b(1\.[0-9]|9|1[0-9]|2[0-9])\b`)
)
