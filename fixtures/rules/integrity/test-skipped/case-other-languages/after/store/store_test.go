package store

import (
	"os"
	"testing"
)

func TestSave(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a database")
	}
	if err := Save("a"); err != nil {
		t.Fatal(err)
	}
}

func TestLoad(t *testing.T) {
	t.Skip("flaky, fix later") // expect-block: integrity/test-skipped
	if Load("a") != "a" {
		t.Fatal("bad value")
	}
}

func TestReader(t *testing.T) {
	if os.Getenv("CI") == "" {
		// ok: a skip inside an if is a deliberate environment check
		t.Skipf("set CI to run %s", t.Name())
	}
	r := newReader([]byte("abcd"))
	// ok: Skip on a reader is not the testing.T method
	r.Skip(2)
	if r.Next() != 'c' {
		t.Fatal("bad reader")
	}
}
