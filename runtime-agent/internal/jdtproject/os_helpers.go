// Package jdtproject — OS-specific helpers.
package jdtproject

import (
	"encoding/json"
	"os"
)

// osReadFile is the only FS hook we need outside the
// generator's own code. Tests can stub it via the
// package-level var to keep the tests fast and hermetic.
var osReadFile = os.ReadFile

// jsonUnmarshal decodes the API payload (which is JSON on
// the Kairo wire protocol).
var jsonUnmarshal = json.Unmarshal

// jsonMarshal is a tiny wrapper exposed to tests so they
// don't have to import encoding/json themselves.
var jsonMarshal = json.Marshal
