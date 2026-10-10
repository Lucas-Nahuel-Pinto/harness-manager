#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
exec bun run serve
