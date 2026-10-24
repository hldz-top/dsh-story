#!/usr/bin/env bash
# Per-run budget meter. Dev tooling only; see scripts/budget/README.md.
#   budget.sh provider
#   budget.sh init
#   budget.sh reset --confirm
#   budget.sh start <tag> <home> <parent_jsonl>
#   budget.sh <tag>
#   budget.sh finish <tag> [status]
#   budget.sh total
#   budget.sh unfinished
#   budget.sh live
#   budget.sh live-begin <pid> <tag>
# Exit: 0 OK, 2 usage/provider, 3 run still alive, 4 OVER_RUN, 5 OVER_TOTAL, 6 MEASURE_FAIL.
set -u
here=$(dirname "$(readlink -f "$0")")
exec python3 "$here/meter.py" "$@"
