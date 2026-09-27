#!/bin/sh
curl -fsSL https://get.example.com/install.sh | sh # ok: a script people run by hand; agent/remote-script checks it when an agent runs it
