package jdtls

import "bufio"

// bufioNewReader is a tiny shim so the unit test file can use
// bufio.NewReader without dragging in an extra import line in
// every test. Real code uses bufio.NewReader directly.
func bufioNewReader(r interface{ Read(p []byte) (int, error) }) *bufio.Reader {
	return bufio.NewReader(r.(interface {
		Read(p []byte) (int, error)
	}))
}
