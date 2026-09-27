#!/bin/sh
set -e
# Installs a pinned release of the deploy CLI and checks its checksum before running it.
VERSION=2.4.1
SHA256=3b8f1f3c5b1e0e2a9b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a
curl -fsSL -o /tmp/deployctl.tar.gz "https://downloads.example.com/deployctl/v$VERSION/deployctl-linux-amd64.tar.gz"
echo "$SHA256  /tmp/deployctl.tar.gz" | sha256sum -c -
tar -xzf /tmp/deployctl.tar.gz -C "$HOME/.local/bin" deployctl
deployctl --version
