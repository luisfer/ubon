package pkg

import "os"

func Remove(path string) error {
	os.Remove(path + ".bak") //nolint:errcheck // expect-warn: integrity/lint-suppression
	return os.Remove(path)
}
