package connparse_test

import (
	"runtime"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
)

func TestParseURI_WSHWithScheme(t *testing.T) {
	t.Parallel()

	// Test with localhost
	cstr := "wsh://user@localhost:8080/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "user@localhost:8080"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "user@localhost:8080/path/to/file"
	pathWithHost := c.GetPathWithHost()
	if pathWithHost != expected {
		t.Fatalf("expected path with host to be \"%q\", got \"%q\"", expected, pathWithHost)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	if len(c.GetSchemeParts()) != 1 {
		t.Fatalf("expected scheme parts to be 1, got %d", len(c.GetSchemeParts()))
	}

	// Test with an IP address
	cstr = "wsh://user@192.168.0.1:22/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "user@192.168.0.1:22"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "user@192.168.0.1:22/path/to/file"
	pathWithHost = c.GetPathWithHost()
	if pathWithHost != expected {
		t.Fatalf("expected path with host to be \"%q\", got \"%q\"", expected, pathWithHost)
	}
	expected = "wsh"
	if c.GetType() != expected {
		t.Fatalf("expected conn type to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	if len(c.GetSchemeParts()) != 1 {
		t.Fatalf("expected scheme parts to be 1, got %d", len(c.GetSchemeParts()))
	}
	got := c.GetFullURI()
	if got != cstr {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", cstr, got)
	}
}

func TestParseURI_WSHRemoteShorthand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("TODO: fix Windows path semantics")
	}
	t.Parallel()

	// Test with a simple remote path
	cstr := "//conn/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	if c.Host != "conn" {
		t.Fatalf("expected host to be empty, got \"%q\"", c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://conn/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}

	// Test with a complex remote path
	cstr = "//user@localhost:8080/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "user@localhost:8080"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://user@localhost:8080/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}

	// Test with an IP address
	cstr = "//user@192.168.0.1:8080/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "user@192.168.0.1:8080"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://user@192.168.0.1:8080/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}
}

func TestParseURI_WSHCurrentPathShorthand(t *testing.T) {
	t.Parallel()

	// Test with a relative path to home
	cstr := "~/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "~/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://current/~/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}

	// Test with a absolute path
	cstr = "/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	expected = "/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://current/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}
}

func TestParseURI_WSHCurrentPath(t *testing.T) {
	cstr := "./Documents/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "./Documents/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://current/./Documents/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}

	cstr = "path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be %q, got %q", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be %q, got %q", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be %q, got %q", expected, c.Scheme)
	}
	expected = "wsh://current/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be %q, got %q", expected, c.GetFullURI())
	}

	cstr = "/etc/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "/etc/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be %q, got %q", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be %q, got %q", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be %q, got %q", expected, c.Scheme)
	}
	expected = "wsh://current/etc/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be %q, got %q", expected, c.GetFullURI())
	}
}

func TestParseURI_WSHCurrentPathWindows(t *testing.T) {
	cstr := ".\\Documents\\path\\to\\file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := ".\\Documents\\path\\to\\file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "current"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://current/.\\Documents\\path\\to\\file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}
}

func TestParseURI_WSHLocalShorthand(t *testing.T) {
	t.Parallel()
	cstr := "/~/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "~/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	if c.Host != "local" {
		t.Fatalf("expected host to be empty, got \"%q\"", c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}

	cstr = "wsh:///~/path/to/file"
	c, err = connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected = "~/path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	if c.Host != "local" {
		t.Fatalf("expected host to be empty, got \"%q\"", c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://local/~/path/to/file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}
}

func TestParseURI_WSHWSL(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("TODO: fix Windows path semantics")
	}

	t.Parallel()
	cstr := "wsh://wsl://Ubuntu/path/to/file"

	testUri := func() {
		c, err := connparse.ParseURI(cstr)
		if err != nil {
			t.Fatalf("failed to parse URI: %v", err)
		}
		expected := "/path/to/file"
		if c.Path != expected {
			t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
		}
		expected = "wsl://Ubuntu"
		if c.Host != expected {
			t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
		}
		expected = "wsh"
		if c.Scheme != expected {
			t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
		}
		expected = "wsh://wsl://Ubuntu/path/to/file"
		if expected != c.GetFullURI() {
			t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
		}
	}
	t.Log("Testing with scheme")
	testUri()

	t.Log("Testing without scheme")
	cstr = "//wsl://Ubuntu/path/to/file"
	testUri()
}

func TestParseUri_LocalWindowsAbsPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("TODO: fix Windows path semantics")
	}

	t.Parallel()
	cstr := "wsh://local/C:\\path\\to\\file"

	testAbsPath := func() {
		c, err := connparse.ParseURI(cstr)
		if err != nil {
			t.Fatalf("failed to parse URI: %v", err)
		}
		expected := "C:\\path\\to\\file"
		if c.Path != expected {
			t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
		}
		expected = "local"
		if c.Host != expected {
			t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
		}
		expected = "wsh"
		if c.Scheme != expected {
			t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
		}
		expected = "wsh://local/C:\\path\\to\\file"
		if c.GetFullURI() != expected {
			t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
		}
	}

	t.Log("Testing with scheme")
	testAbsPath()
	t.Log("Testing without scheme")
	cstr = "//local/C:\\path\\to\\file"
	testAbsPath()
}

func TestParseURI_LocalWindowsRelativeShorthand(t *testing.T) {
	cstr := "/~\\path\\to\\file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "~\\path\\to\\file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "local"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "wsh"
	if c.Scheme != expected {
		t.Fatalf("expected scheme to be \"%q\", got \"%q\"", expected, c.Scheme)
	}
	expected = "wsh://local/~\\path\\to\\file"
	if c.GetFullURI() != expected {
		t.Fatalf("expected full URI to be \"%q\", got \"%q\"", expected, c.GetFullURI())
	}
}

func TestParseURI_BasicS3(t *testing.T) {
	t.Parallel()
	cstr := "profile:s3://bucket/path/to/file"
	c, err := connparse.ParseURI(cstr)
	if err != nil {
		t.Fatalf("failed to parse URI: %v", err)
	}
	expected := "path/to/file"
	if c.Path != expected {
		t.Fatalf("expected path to be \"%q\", got \"%q\"", expected, c.Path)
	}
	expected = "bucket"
	if c.Host != expected {
		t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
	}
	expected = "bucket/path/to/file"
	pathWithHost := c.GetPathWithHost()
	if pathWithHost != expected {
		t.Fatalf("expected path with host to be \"%q\", got \"%q\"", expected, pathWithHost)
	}
	expected = "s3"
	if c.GetType() != expected {
		t.Fatalf("expected conn type to be \"%q\", got \"%q\"", expected, c.GetType())
	}
	if len(c.GetSchemeParts()) != 2 {
		t.Fatalf("expected scheme parts to be 2, got %d", len(c.GetSchemeParts()))
	}
}

func TestParseURI_S3BucketOnly(t *testing.T) {
	t.Parallel()

	testUri := func(cstr string, pathExpected string, pathWithHostExpected string) {
		c, err := connparse.ParseURI(cstr)
		if err != nil {
			t.Fatalf("failed to parse URI: %v", err)
		}
		if c.Path != pathExpected {
			t.Fatalf("expected path to be \"%q\", got \"%q\"", pathExpected, c.Path)
		}
		expected := "bucket"
		if c.Host != expected {
			t.Fatalf("expected host to be \"%q\", got \"%q\"", expected, c.Host)
		}
		pathWithHost := c.GetPathWithHost()
		if pathWithHost != pathWithHostExpected {
			t.Fatalf("expected path with host to be \"%q\", got \"%q\"", expected, pathWithHost)
		}
		expected = "s3"
		if c.GetType() != expected {
			t.Fatalf("expected conn type to be \"%q\", got \"%q\"", expected, c.GetType())
		}
		if len(c.GetSchemeParts()) != 2 {
			t.Fatalf("expected scheme parts to be 2, got %d", len(c.GetSchemeParts()))
		}
		fullUri := c.GetFullURI()
		if fullUri != cstr {
			t.Fatalf("expected full URI to be \"%q\", got \"%q\"", cstr, fullUri)
		}
	}

	t.Log("Testing with no trailing slash")
	testUri("profile:s3://bucket", "", "bucket")
	t.Log("Testing with trailing slash")
	testUri("profile:s3://bucket/", "/", "bucket/")
}
