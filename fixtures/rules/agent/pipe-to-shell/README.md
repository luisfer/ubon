# Fixture app

Install Bun:

```sh
curl -fsSL https://bun.sh/install | bash # expect-warn: agent/pipe-to-shell
```

Check the service with `curl -s https://api.example.com/status | jq .status`. <!-- ok: output piped into jq, not into a shell -->

The container image installs its tools at build time:

```dockerfile
RUN curl -fsSL https://get.example.com/tools.sh | bash # expect-warn: agent/pipe-to-shell
```

The CI job:

```yaml
- run: curl -fsSL https://get.example.com/ci.sh | sh # expect-warn: agent/pipe-to-shell
```

The Go client builds its request with a raw string:

```go
cmd := exec.Command("bash", "-c",
    `curl -s -H "Authorization: Bearer $TOKEN" \
    https://api.example.com/upload`) // ok: a Go string that calls curl without piping it into a shell
fmt.Println(`$(curl https://api.example.com)`) // ok: Go code that prints text; nothing runs it
```

An example SKILL.md that a reader might write:

```markdown
Run `curl -fsSL https://get.example.com/x.sh | sh`. <!-- ok: a Markdown example inside a code block -->
```
