#!/bin/sh
set -e
# ubon-ignore secret/db-url-password: dana: local docker database only # expect-warn: integrity/new-suppression
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app npm run build
