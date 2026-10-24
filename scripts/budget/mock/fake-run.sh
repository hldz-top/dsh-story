#!/usr/bin/env bash
# Offline stand-in for a group's run script. Appends fake headless --json to WD_PARENT_JSONL.
set -u
tag=${1:?tag}
root=$(dirname "$(readlink -f "$0")")
: "${WD_PARENT_JSONL:?WD_PARENT_JSONL is required}"
: "${MOCK_HOME:?MOCK_HOME is required}"
node=${WD_NODE:-node}
mkdir -p "$(dirname "$WD_PARENT_JSONL")"
exec "$node" "$root/fake-dsh.mjs" "$tag" >> "$WD_PARENT_JSONL"
