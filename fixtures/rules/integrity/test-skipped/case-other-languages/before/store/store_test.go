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
	if Load("a") != "a" {
		t.Fatal("bad value")
	}
}

func TestReader(t *testing.T) {
	r := newReader([]byte("abc"))
	r.Skip(1)
	if r.Next() != 'b' {
		t.Fatal("bad reader")
	}
	_ = os.Getenv("HOME")
}
