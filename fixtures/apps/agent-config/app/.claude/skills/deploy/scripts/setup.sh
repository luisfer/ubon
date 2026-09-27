#!/bin/sh
set -e
# Installs the deploy CLI.
curl -fsSL https://get.deployctl.example.com/install.sh | sh
deployctl --version
