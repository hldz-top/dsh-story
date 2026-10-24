#!/usr/bin/env bash
# Offline mock for scripts/budget. No model, no network, no provider key.
#   bash scripts/budget/mock/check.sh [scenario ...]
set -u
M=$(dirname "$(readlink -f "$0")")
B=$(readlink -f "$M/..")
W=$M/work
NODE=${WD_NODE:-node}
export WD_NODE=$NODE

drive() {
  local s=$1 t=$2 h=$3
  shift 3
  mkdir -p "$W/$s/state"
  if [[ ! -f $W/$s/state/ledger.tsv ]]; then
    env WD_STATE="$W/$s/state" "$B/budget.sh" init >"$W/$s/init.out"
  fi
  if [[ ! -e $W/$s/$h ]]; then
    MOCK_HOME="$W/$s/$h" MOCK_CALLS=37 MOCK_PAR=1 MOCK_CALL_MS=1 "$NODE" "$M/fake-dsh.mjs" seed >/dev/null
  fi
  env WD_OFFLINE=1 WD_NODE="$NODE" WD_STATE="$W/$s/state" WD_HOME="$W/$s/$h" MOCK_HOME="$W/$s/$h" \
    WD_PARENT_JSONL="$W/$s/run-$t.jsonl" MOCK_TRUTH="$W/$s/$t.truth.json" \
    WD_RUN_CMD="$M/fake-run.sh" WD_SIGNAL_MATCH='fake-dsh\.mjs' WD_GRACE=8 \
    "$@" "$B/drive.sh" "$t" >"$W/$s/$t.out" 2>&1
  echo $? >"$W/$s/$t.rc"
}

empty_home() {
  local home=$1
  mkdir -p "$home/storages"
  printf '%s\n' '{"tables":{"novels":{}}}' >"$home/storages/story_runs.json"
}

batch_case() {
  local name=$1 body=$2
  printf '%s' "$body" | "$NODE" "$B/usage.mjs" --batch >"$S/$name.out" 2>"$S/$name.err"
  echo $? >"$S/$name.rc"
}

parent_case() {
  local name=$1 body=$2
  local st=$S/$name/state home=$S/$name/home pj=$S/$name/parent.jsonl
  mkdir -p "$st"
  empty_home "$home"
  env WD_STATE="$st" "$B/budget.sh" init >"$S/$name.init"
  env WD_STATE="$st" "$B/budget.sh" start "$name" "$home" "$pj" >"$S/$name.start"
  printf '%s\n' "$body" >"$pj"
  env WD_STATE="$st" "$B/budget.sh" "$name" >"$S/$name.out" 2>"$S/$name.err"
  echo $? >"$S/$name.rc"
}

child_case() {
  local name=$1 raw=$2
  local st=$S/$name/state home=$S/$name/home pj=$S/$name/parent.jsonl
  mkdir -p "$st"
  empty_home "$home"
  env WD_STATE="$st" "$B/budget.sh" init >"$S/$name.init"
  env WD_STATE="$st" "$B/budget.sh" start "$name" "$home" "$pj" >"$S/$name.start"
  "$NODE" "$M/fixture.mjs" "$home" "$raw"
  "$NODE" "$B/usage.mjs" "$home" >"$S/$name.usage.out" 2>"$S/$name.usage.err"
  echo $? >"$S/$name.usage.rc"
  env WD_STATE="$st" "$B/budget.sh" "$name" >"$S/$name.out" 2>"$S/$name.err"
  echo $? >"$S/$name.rc"
}

s_completes_199() { drive completes_199 r1 home MOCK_CALLS=199 MOCK_PAR=1 MOCK_CALL_MS=400 WD_POLL=0.2; }
s_completes_200() { drive completes_200 r1 home MOCK_CALLS=200 MOCK_PAR=1 MOCK_CALL_MS=400 WD_POLL=0.2; }
s_limit_exact() {
  drive limit_exact r1 home MOCK_CALLS=260 MOCK_PAR=1 MOCK_CALL_MS=800 WD_POLL=0.2
  cp "$W/limit_exact/state/ledger.tsv" "$W/limit_exact/ledger-after-first.tsv"
  cp "$W/limit_exact/r1.out" "$W/limit_exact/r1-first.out"
  cp "$W/limit_exact/r1.rc" "$W/limit_exact/r1-first.rc"
  cp "$W/limit_exact/state/r1.stop" "$W/limit_exact/r1-first.stop"
  drive limit_exact r1 home MOCK_RESUME=1 MOCK_CALLS=260 MOCK_PAR=1 MOCK_CALL_MS=800 WD_POLL=0.2
  mv "$W/limit_exact/r1.rc" "$W/limit_exact/r1-resume.rc"
  mv "$W/limit_exact/r1.out" "$W/limit_exact/r1-resume.out"
  drive limit_exact r1 home MOCK_RESUME=1 MOCK_CALLS=260 MOCK_PAR=1 MOCK_CALL_MS=400 WD_POLL=0.2 \
    WD_RUN_LIMIT=210 MOCK_TRUTH="$W/limit_exact/r1-resume210.truth.json"
  mv "$W/limit_exact/r1.rc" "$W/limit_exact/r1-resume210.rc"
  mv "$W/limit_exact/r1.out" "$W/limit_exact/r1-resume210.out"
}
s_realistic_poll2() { drive realistic_poll2 r1 home MOCK_CALLS=260 MOCK_PAR=2 MOCK_CALL_MS=2500 WD_POLL=2; }
s_realistic_poll20() { drive realistic_poll20 r1 home MOCK_CALLS=260 MOCK_PAR=2 MOCK_CALL_MS=2500 WD_POLL=20; }
s_total_10m() {
  local i h
  for i in 1 2; do
    h=home-$((i - 1))
    drive total_10m "r$i" "$h" MOCK_CALLS=50 MOCK_INPUT=100000 MOCK_CACHED=0 MOCK_PAR=1 MOCK_CALL_MS=1 WD_POLL=0.2
  done
  drive total_10m r3 home-1 MOCK_CALLS=40 MOCK_INPUT=1 MOCK_CACHED=0 MOCK_PAR=1 MOCK_CALL_MS=200 WD_POLL=0.2
  drive total_10m r4 home-2 MOCK_CALLS=10 MOCK_INPUT=1 MOCK_CACHED=0 MOCK_PAR=1 MOCK_CALL_MS=50 WD_POLL=0.2
}

s_missing_ledger() {
  local S=$W/missing_ledger
  empty_home "$S/home"
  # WD_RAN is expanded by mark.sh, not by this harness.
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/bash' 'touch "$WD_RAN"' >"$S/mark.sh"
  chmod +x "$S/mark.sh"
  env WD_OFFLINE=1 WD_STATE="$S/none" WD_HOME="$S/home" WD_RUN_CMD="$S/mark.sh" WD_RAN="$S/ran-none" \
    "$B/drive.sh" t1 >"$S/drive-missing.out" 2>&1
  echo $? >"$S/drive-missing.rc"
  mkdir -p "$S/empty/state"
  : >"$S/empty/state/ledger.tsv"
  cp "$S/empty/state/ledger.tsv" "$S/empty-before"
  env WD_STATE="$S/empty/state" "$B/budget.sh" total >"$S/empty.out" 2>"$S/empty.err"
  echo $? >"$S/empty.rc"
  cp "$S/empty/state/ledger.tsv" "$S/empty-after"
  local life=$S/life/state
  mkdir -p "$life" "$S/life/home/storages"
  printf '%s\n' '{"tables":{"novels":{}}}' >"$S/life/home/storages/story_runs.json"
  env WD_STATE="$life" "$B/budget.sh" init >"$S/init.out" 2>"$S/init.err"
  echo $? >"$S/init.rc"
  env WD_STATE="$life" "$B/budget.sh" total >"$S/total0.out" 2>"$S/total0.err"
  echo $? >"$S/total0.rc"
  cp "$life/ledger.tsv" "$S/ledger-after-init"
  env WD_STATE="$life" "$B/budget.sh" init >"$S/init2.out" 2>"$S/init2.err"
  echo $? >"$S/init2.rc"
  cp "$life/ledger.tsv" "$S/ledger-after-init2"
  env WD_STATE="$life" "$B/budget.sh" reset >"$S/reset-no.out" 2>"$S/reset-no.err"
  echo $? >"$S/reset-no.rc"
  env WD_STATE="$life" "$B/budget.sh" start sample "$S/life/home" "$S/life/parent.jsonl" >"$S/sample.start"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":50,"outputTokens":1}}' >"$S/life/parent.jsonl"
  env WD_STATE="$life" "$B/budget.sh" finish sample counted >"$S/sample.finish"
  env WD_STATE="$life" "$B/budget.sh" reset --confirm >"$S/reset.out" 2>"$S/reset.err"
  echo $? >"$S/reset.rc"
  env WD_STATE="$life" "$B/budget.sh" total >"$S/total-reset.out"
  echo $? >"$S/total-reset.rc"
  rm -f "$life/ledger.tsv"
  env WD_STATE="$life" "$B/budget.sh" total >"$S/deleted.out" 2>"$S/deleted.err"
  echo $? >"$S/deleted.rc"
  if [[ -f $life/ledger.tsv ]]; then echo present >"$S/deleted.flag"; else echo absent >"$S/deleted.flag"; fi
}

s_measure_fail() {
  drive measure_fail r1 home MOCK_CALLS=40 MOCK_PAR=1 MOCK_CALL_MS=300 WD_POLL=0.2 &
  local pid
  pid=$!
  local i
  for i in $(seq 1 100); do
    if [[ -f $W/measure_fail/state/r1.drive.log ]] && grep -q 'started ' "$W/measure_fail/state/r1.drive.log"; then
      break
    fi
    sleep 0.1
  done
  rm -f "$W/measure_fail/home/storages/story_runs.json"
  wait "$pid" || true
}

s_kill9_resume() {
  local S=$W/kill9_resume
  drive kill9_resume r0 home MOCK_CALLS=2 MOCK_INPUT=1000 MOCK_PAR=1 MOCK_CALL_MS=30 WD_POLL=0.1
  cp "$S/state/ledger.tsv" "$S/ledger-before-kill.tsv"
  env WD_OFFLINE=1 WD_NODE="$NODE" WD_STATE="$S/state" WD_HOME="$S/home" MOCK_HOME="$S/home" \
    WD_PARENT_JSONL="$S/run-r1.jsonl" MOCK_TRUTH="$S/r1-killed.truth.json" \
    WD_RUN_CMD="$M/fake-run.sh" WD_SIGNAL_MATCH='fake-dsh\.mjs' WD_GRACE=8 \
    MOCK_CALLS=40 MOCK_INPUT=1000 MOCK_PAR=1 MOCK_CALL_MS=200 WD_POLL=0.2 \
    "$B/drive.sh" r1 >"$S/r1-killed.out" 2>&1 &
  local dpid=$!
  local i
  for i in $(seq 1 150); do
    if [[ -f $S/state/r1.drive.log ]] && grep -E 'calls=([2-9]|[1-9][0-9]+)/' "$S/state/r1.drive.log" >/dev/null; then
      break
    fi
    sleep 0.1
  done
  grep -E 'run r1: calls=' "$S/state/r1.drive.log" | tail -n 1 >"$S/calls-before.txt" || true
  local runpid
  runpid=$(sed -n 's/.* pid=\([0-9][0-9]*\) .*/\1/p' "$S/state/r1.drive.log" | head -n 1)
  if [[ -n ${runpid:-} ]]; then
    kill -9 "$runpid" 2>/dev/null || true
  fi
  kill -9 "$dpid" 2>/dev/null || true
  wait "$dpid" || true
  local _
  for _ in $(seq 1 50); do
    if flock -n "$S/state/drive.lock" -c true; then
      break
    fi
    sleep 0.05
  done
  for _ in $(seq 1 50); do
    if env WD_STATE="$S/state" "$B/budget.sh" live >"$S/live-after-kill.out" 2>"$S/live-after-kill.err"; then
      break
    fi
    sleep 0.05
  done
  cp "$S/state/ledger.tsv" "$S/ledger-after-kill.tsv"
  env WD_STATE="$S/state" "$B/budget.sh" total >"$S/total-after-kill.out" 2>"$S/total-after-kill.err"
  echo $? >"$S/total-after-kill.rc"
  drive kill9_resume r1 home MOCK_RESUME=1 MOCK_CALLS=8 MOCK_INPUT=1000 MOCK_PAR=1 MOCK_CALL_MS=40 WD_POLL=0.1
  cp "$S/state/ledger.tsv" "$S/ledger-after-resume.tsv"
  env WD_STATE="$S/state" "$B/budget.sh" finish r1 duplicate >"$S/dup.out"
  cp "$S/state/ledger.tsv" "$S/ledger-after-dup.tsv"
}

s_ledger_persist() {
  local S=$W/ledger_persist
  local ST=$S/state
  local h
  mkdir -p "$ST"
  for h in h1 h2 h3 h4; do
    empty_home "$S/$h"
  done
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/init.out"
  env WD_STATE="$ST" "$B/budget.sh" start t1 "$S/h1" "$S/t1.jsonl"
  env WD_STATE="$ST" "$B/budget.sh" start t2 "$S/h2" "$S/t2.jsonl"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":1000,"outputTokens":1}}' >"$S/t1.jsonl"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":2000,"outputTokens":1}}' >"$S/t2.jsonl"
  env WD_STATE="$ST" "$B/budget.sh" finish t1 first
  cp "$ST/ledger.tsv" "$S/after-first.tsv"
  env WD_STATE="$ST" "$B/budget.sh" finish t1 duplicate
  cp "$ST/ledger.tsv" "$S/after-duplicate.tsv"
  env WD_STATE="$ST" WD_CRASH_BEFORE_LEDGER_WRITE=1 "$B/budget.sh" finish t2 crash >"$S/crash.out" 2>"$S/crash.err"
  echo $? >"$S/crash.rc"
  cp "$ST/ledger.tsv" "$S/after-crash.tsv"
  env WD_STATE="$ST" WD_LEDGER_PAUSE=2 "$B/budget.sh" finish t2 pause >"$S/pause.out" 2>"$S/pause.err" &
  local paused
  paused=$!
  sleep 0.4
  kill -9 "$paused" 2>/dev/null || true
  wait "$paused" || true
  cp "$ST/ledger.tsv" "$S/after-kill.tsv"
  env WD_STATE="$ST" "$B/budget.sh" finish t2 ok
  cp "$ST/ledger.tsv" "$S/after-t2.tsv"
  env WD_STATE="$ST" "$B/budget.sh" finish t2 again
  cp "$ST/ledger.tsv" "$S/after-t2-dup.tsv"
  env WD_STATE="$ST" "$B/budget.sh" start t3 "$S/h3" "$S/t3.jsonl"
  env WD_STATE="$ST" "$B/budget.sh" start t4 "$S/h4" "$S/t4.jsonl"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":1000,"outputTokens":1}}' >"$S/t3.jsonl"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":3000,"outputTokens":1}}' >"$S/t4.jsonl"
  env WD_STATE="$ST" WD_LEDGER_PAUSE=0.6 "$B/budget.sh" finish t3 side >"$S/t3.out" 2>"$S/t3.err" &
  env WD_STATE="$ST" WD_LEDGER_PAUSE=0.6 "$B/budget.sh" finish t4 side >"$S/t4.out" 2>"$S/t4.err" &
  wait
  cp "$ST/ledger.tsv" "$S/after-concurrent.tsv"
  env WD_STATE="$ST" WD_LEDGER_PAUSE=0.4 "$B/budget.sh" finish t3 same-a >"$S/same-a.out" 2>"$S/same-a.err" &
  env WD_STATE="$ST" WD_LEDGER_PAUSE=0.4 "$B/budget.sh" finish t3 same-b >"$S/same-b.out" 2>"$S/same-b.err" &
  wait
  cp "$ST/ledger.tsv" "$S/after-same.tsv"
}

s_usage_parse() {
  local S=$W/usage_parse
  mkdir -p "$S"
  if grep -nE 'inputTokens., 0|inputTokens.. 0|\?\? 0|or 0|dashscope|bailian|sk-' \
    "$B/meter.py" "$B/usage.mjs" "$B/drive.sh" "$B/budget.sh" \
    "$M/fake-dsh.mjs" "$M/fixture.mjs" "$M/fake-run.sh"; then
    echo 1 >"$S/grep.rc"
  else
    echo 0 >"$S/grep.rc"
  fi
  batch_case batch-missing '{"usages":[null]}'
  batch_case batch-non-numeric '{"usages":[{"inputTokens":"12"}]}'
  batch_case batch-zero '{"usages":[{"inputTokens":0,"outputTokens":0}]}'
  batch_case batch-zero-and-five '{"usages":[{"inputTokens":0},{"inputTokens":5}]}'
  batch_case batch-openai '{"usages":[{"prompt_tokens":1500,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":500}}]}'
  batch_case batch-no-details '{"usages":[{"prompt_tokens":800,"completion_tokens":1}]}'
  batch_case batch-prompt-bad '{"usages":[{"prompt_tokens":"no","inputTokens":5}]}'
  batch_case batch-prompt-missing '{"usages":[{"prompt_tokens_details":{"cached_tokens":3},"inputTokens":5}]}'
  batch_case batch-cache-ignored '{"usages":[{"inputTokens":10,"cacheReadTokens":50000000,"outputTokens":1}]}'
  parent_case parent-missing '{"type":"agent/step","phase":"step_end"}'
  parent_case parent-non-numeric '{"type":"agent/step","phase":"step_end","usage":{"inputTokens":"12"}}'
  parent_case parent-zero '{"type":"agent/step","phase":"step_end","usage":{"inputTokens":0,"outputTokens":3}}'
  parent_case parent-openai '{"type":"agent/step","phase":"step_end","usage":{"prompt_tokens":1500,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":500},"inputTokens":1}}'
  parent_case parent-no-details '{"type":"agent/step","phase":"step_end","usage":{"prompt_tokens":800,"completion_tokens":1}}'
  parent_case parent-cache '{"type":"agent/step","phase":"step_end","usage":{"inputTokens":10,"cacheReadTokens":50000000,"outputTokens":1}}'
  local st=$S/parent-boundary/state home=$S/parent-boundary/home pj=$S/parent-boundary/parent.jsonl
  mkdir -p "$st"
  empty_home "$home"
  env WD_STATE="$st" "$B/budget.sh" init >"$S/parent-boundary.init"
  env WD_STATE="$st" "$B/budget.sh" start parent-boundary "$home" "$pj" >"$S/parent-boundary.start"
  printf '%s\n' '{"phase":"step_end","usage":{"prompt_tokens":10000000,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0}}}' >"$pj"
  env WD_STATE="$st" "$B/budget.sh" parent-boundary >"$S/parent-boundary-at.out" 2>"$S/parent-boundary-at.err"
  echo $? >"$S/parent-boundary-at.rc"
  printf '%s\n' '{"phase":"step_end","usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0}}}' >>"$pj"
  env WD_STATE="$st" "$B/budget.sh" parent-boundary >"$S/parent-boundary-over.out" 2>"$S/parent-boundary-over.err"
  echo $? >"$S/parent-boundary-over.rc"
  child_case child-missing ABSENT
  child_case child-non-numeric '{"inputTokens":"12"}'
  child_case child-zero '{"inputTokens":0,"outputTokens":0}'
  child_case child-openai '{"prompt_tokens":1500,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":500},"inputTokens":1}'
}

s_provider_env() {
  local S=$W/provider_env
  mkdir -p "$S/state"
  empty_home "$S/home"
  # WD_RAN is expanded by mark.sh, not by this harness.
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/bash' 'touch "$WD_RAN"' >"$S/mark.sh"
  chmod +x "$S/mark.sh"
  env -u ALIYUN_TOKEN_PLAN_BASE_URL -u ALIYUN_TOKEN_PLAN_API_KEY \
    "$B/budget.sh" provider >"$S/missing.out" 2>"$S/missing.err"
  echo $? >"$S/missing.rc"
  env -u ALIYUN_TOKEN_PLAN_API_KEY ALIYUN_TOKEN_PLAN_BASE_URL='https://example.test/v1' \
    "$B/budget.sh" provider >"$S/only-url.out" 2>"$S/only-url.err"
  echo $? >"$S/only-url.rc"
  env -u ALIYUN_TOKEN_PLAN_BASE_URL ALIYUN_TOKEN_PLAN_API_KEY='sentinel-key-do-not-print' \
    "$B/budget.sh" provider >"$S/only-key.out" 2>"$S/only-key.err"
  echo $? >"$S/only-key.rc"
  env ALIYUN_TOKEN_PLAN_BASE_URL='   ' ALIYUN_TOKEN_PLAN_API_KEY='sentinel-key-do-not-print' \
    "$B/budget.sh" provider >"$S/blank.out" 2>"$S/blank.err"
  echo $? >"$S/blank.rc"
  env ALIYUN_TOKEN_PLAN_BASE_URL='https://example.test/v1' ALIYUN_TOKEN_PLAN_API_KEY='sentinel-key-do-not-print' \
    "$B/budget.sh" provider >"$S/ok.out" 2>"$S/ok.err"
  echo $? >"$S/ok.rc"
  env -u ALIYUN_TOKEN_PLAN_BASE_URL -u ALIYUN_TOKEN_PLAN_API_KEY \
    WD_STATE="$S/state" WD_HOME="$S/home" WD_RUN_CMD="$S/mark.sh" WD_RAN="$S/ran" \
    "$B/drive.sh" t1 >"$S/drive.out" 2>"$S/drive.err"
  echo $? >"$S/drive.rc"
}

s_reset_settled() {
  local S=$W/reset_settled
  local ST=$S/state home=$S/home pj=$S/parent.jsonl
  mkdir -p "$ST"
  empty_home "$home"
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/init.out"
  env WD_STATE="$ST" "$B/budget.sh" start settled "$home" "$pj" >"$S/start.out"
  printf '%s\n' '{"phase":"step_end","usage":{"inputTokens":6000000,"outputTokens":1}}' >"$pj"
  env WD_STATE="$ST" "$B/budget.sh" finish settled counted >"$S/finish.out"
  cp "$ST/ledger.tsv" "$S/ledger-before"
  cp "$ST/settled.base.json" "$S/base-before"
  env WD_RESET=1 WD_STATE="$ST" "$B/budget.sh" start settled "$home" "$pj" >"$S/reset.out" 2>"$S/reset.err"
  echo $? >"$S/reset.rc"
  cp "$ST/ledger.tsv" "$S/ledger-after"
  cp "$ST/settled.base.json" "$S/base-after"
}

s_attempt_logs() {
  local S=$W/attempt_logs
  local ST=$S/state home=$S/home pj=$S/parent.jsonl
  mkdir -p "$ST" "$home/storages"
  python3 - "$home/storages/story_runs.json" <<'PY'
import json, sys
json.dump({"tables": {"novels": {"n": {"runs": [{
  "id": "run_old", "status": "running", "attempts": [
    {"id": "old1", "status": "succeeded", "childSessionId": "sess-old", "request": {"key": "stage/0"}},
    {"id": "span1", "status": "running", "childSessionId": "sess-span", "request": {"key": "stage/1"}},
  ],
}]}}}}, open(sys.argv[1], "w"))
PY
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/init.out"
  env WD_STATE="$ST" "$B/budget.sh" start logs "$home" "$pj" >"$S/start.out"
  env WD_STATE="$ST" "$B/budget.sh" logs >"$S/open.out" 2>"$S/open.err"
  echo $? >"$S/open.rc"
  python3 - "$home/storages/story_runs.json" <<'PY'
import json, sys
path = sys.argv[1]
store = json.load(open(path))
store["tables"]["novels"]["n"]["runs"][0]["attempts"][1]["status"] = "succeeded"
json.dump(store, open(path, "w"))
PY
  env WD_STATE="$ST" "$B/budget.sh" logs >"$S/span.out" 2>"$S/span.err"
  echo $? >"$S/span.rc"
  python3 - "$home/storages/story_runs.json" <<'PY'
import json, sys
path = sys.argv[1]
store = json.load(open(path))
store["tables"]["novels"]["n"]["runs"][0]["attempts"].append(
  {"id": "new1", "status": "succeeded", "childSessionId": "sess-new", "request": {"key": "stage/2"}}
)
json.dump(store, open(path, "w"))
PY
  env WD_STATE="$ST" "$B/budget.sh" logs >"$S/two.out" 2>"$S/two.err"
  echo $? >"$S/two.rc"
}

s_ledger_duplicate() {
  local S=$W/ledger_duplicate
  local ST=$S/state
  mkdir -p "$ST"
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/init.out"
  printf '%s\n' $'t1\t/\t1\t1000\t0\t0\tmanual\t2026-01-01T00:00:00Z' >>"$ST/ledger.tsv"
  printf '%s\n' $'t1\t/\t1\t5000\t0\t0\tmanual\t2026-01-01T00:00:00Z' >>"$ST/ledger.tsv"
  env WD_STATE="$ST" "$B/budget.sh" total >"$S/total.out" 2>"$S/total.err"
  echo $? >"$S/total.rc"
}

s_mutants() {
  local S=$W/mutants
  mkdir -p "$S"
  batch_case batch-bad-cached '{"usages":[{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":"5"}}]}'
  batch_case batch-cached-over '{"usages":[{"prompt_tokens":10,"prompt_tokens_details":{"cached_tokens":11}}]}'
  local ST=$S/below/state home=$S/below/home pj=$S/below/parent.jsonl
  mkdir -p "$ST"
  empty_home "$home"
  "$NODE" "$M/fixture.mjs" "$home" '{"inputTokens":100,"outputTokens":1}'
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/below.init"
  env WD_STATE="$ST" "$B/budget.sh" start below "$home" "$pj" >"$S/below.start"
  printf '%s\n' '{"tables":{"novels":{"n":{"runs":[]}}}}' >"$home/storages/story_runs.json"
  env WD_STATE="$ST" "$B/budget.sh" below >"$S/below.out" 2>"$S/below.err"
  echo $? >"$S/below.rc"
}

s_corrupt_files() {
  local S=$W/corrupt_files
  local utf=$S/utf/state empty=$S/empty/state base=$S/base/state home=$S/base/home pj=$S/base/parent.jsonl
  mkdir -p "$utf" "$empty" "$base"
  env WD_STATE="$utf" "$B/budget.sh" init >"$S/utf.init"
  printf '\377' >>"$utf/ledger.tsv"
  env WD_STATE="$utf" "$B/budget.sh" total >"$S/utf.out" 2>"$S/utf.err"
  echo $? >"$S/utf.rc"
  printf '%s\n' '# created= start=0' >"$empty/ledger.tsv"
  env WD_STATE="$empty" "$B/budget.sh" total >"$S/empty.out" 2>"$S/empty.err"
  echo $? >"$S/empty.rc"
  empty_home "$home"
  env WD_STATE="$base" "$B/budget.sh" init >"$S/base.init"
  env WD_STATE="$base" "$B/budget.sh" start broken "$home" "$pj" >"$S/base.start"
  printf '{' >"$base/broken.base.json"
  env WD_STATE="$base" "$B/budget.sh" broken >"$S/base.out" 2>"$S/base.err"
  echo $? >"$S/base.rc"
}

s_live_run() {
  local S=$W/live_run
  local ST=$S/state
  mkdir -p "$ST"
  python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' sleep 120 &
  local sleeper=$!
  env WD_STATE="$ST" "$B/budget.sh" live-begin "$sleeper" forged >"$S/begin.out" 2>"$S/begin.err"
  echo $? >"$S/begin.rc"
  env WD_STATE="$ST" "$B/budget.sh" live >"$S/real.out" 2>"$S/real.err"
  echo $? >"$S/real.rc"
  python3 - "$ST/live-run.json" <<'PY'
import json, sys
path = sys.argv[1]
record = json.load(open(path))
record["starttime"] += 1
json.dump(record, open(path, "w"))
PY
  env WD_STATE="$ST" "$B/budget.sh" live >"$S/forged.out" 2>"$S/forged.err"
  echo $? >"$S/forged.rc"
  env WD_STATE="$ST" "$B/budget.sh" finish none >"$S/forged-finish.out" 2>"$S/forged-finish.err"
  echo $? >"$S/forged-finish.rc"
  python3 - "$ST/live-run.json" <<'PY'
import json, sys
path = sys.argv[1]
record = json.load(open(path))
record["starttime"] -= 1
json.dump(record, open(path, "w"))
PY
  env WD_STATE="$ST" "$B/budget.sh" finish none >"$S/alive-finish.out" 2>"$S/alive-finish.err"
  echo $? >"$S/alive-finish.rc"
  kill "$sleeper" 2>/dev/null || true
  wait "$sleeper" 2>/dev/null || true
  env WD_STATE="$ST" "$B/budget.sh" live >"$S/dead.out" 2>"$S/dead.err"
  echo $? >"$S/dead.rc"
  local home=$S/home
  mkdir -p "$home/storages"
  printf '%s\n' '{"tables":{"novels":{"novel_mock":{"runs":[]}}}}' >"$home/storages/story_runs.json"
  env WD_STATE="$ST" "$B/budget.sh" init >"$S/init.out"
  env WD_OFFLINE=1 WD_NODE="$NODE" WD_STATE="$ST" WD_HOME="$home" MOCK_HOME="$home" \
    WD_PARENT_JSONL="$S/run-held.jsonl" MOCK_TRUTH="$S/held.truth.json" \
    WD_RUN_CMD="$M/fake-run.sh" WD_SIGNAL_MATCH='fake-dsh\.mjs' WD_GRACE=8 \
    MOCK_CALLS=40 MOCK_PAR=1 MOCK_CALL_MS=400 WD_POLL=2 \
    "$B/drive.sh" held >"$S/held.out" 2>&1 &
  local driver=$!
  local i
  for i in $(seq 1 50); do
    if python3 -c 'import json,sys; raise SystemExit(0 if json.load(open(sys.argv[1])).get("tag")=="held" else 1)' "$ST/live-run.json" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  kill -9 "$driver" 2>/dev/null || true
  wait "$driver" 2>/dev/null || true
  local _
  for _ in $(seq 1 50); do
    if flock -n "$ST/drive.lock" -c true; then
      break
    fi
    sleep 0.05
  done
  local pgid
  pgid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pgid"])' "$ST/live-run.json")
  local mypgid
  mypgid=$(ps -o pgid= -p $$ | tr -d ' ')
  if [[ $pgid == "$mypgid" ]]; then
    echo "refusing to signal the shell process group $pgid" >"$S/pgid-guard"
    pgid=
  fi
  env WD_STATE="$ST" "$B/budget.sh" start other "$home" "$S/run-other.jsonl" >"$S/other-start.out" 2>"$S/other-start.err"
  echo $? >"$S/other-start.rc"
  env WD_STATE="$ST" "$B/budget.sh" finish held >"$S/held-finish.out" 2>"$S/held-finish.err"
  echo $? >"$S/held-finish.rc"
  env WD_OFFLINE=1 WD_STATE="$ST" WD_HOME="$home" WD_RUN_CMD="$M/fake-run.sh" WD_PARENT_JSONL="$S/run-other.jsonl" \
    MOCK_HOME="$home" MOCK_CALLS=1 MOCK_CALL_MS=1 \
    "$B/drive.sh" other >"$S/other-drive.out" 2>&1
  echo $? >"$S/other-drive.rc"
  if [[ -n $pgid ]]; then
    kill -9 -- -"$pgid" 2>/dev/null || true
  fi
  local _
  for _ in $(seq 1 50); do
    if env WD_STATE="$ST" "$B/budget.sh" live >"$S/after-live.out" 2>"$S/after-live.err"; then
      break
    fi
    sleep 0.05
  done
  env WD_STATE="$ST" "$B/budget.sh" start other "$home" "$S/run-other.jsonl" >"$S/after-start.out" 2>"$S/after-start.err"
  echo $? >"$S/after-start.rc"
  env WD_STATE="$ST" "$B/budget.sh" finish held >"$S/after-finish.out" 2>"$S/after-finish.err"
  echo $? >"$S/after-finish.rc"
}

s_final_calls() { drive final_calls r1 home MOCK_CALLS=230 MOCK_PAR=1 MOCK_CALL_MS=5 WD_POLL=10; }
s_final_tokens() { drive final_tokens r1 home MOCK_CALLS=3 MOCK_INPUT=4000000 MOCK_PAR=1 MOCK_CALL_MS=200 WD_POLL=10; }
s_final_missing_log() {
  local S=$W/final_missing_log
  local home=$S/home st=$S/state
  mkdir -p "$st" "$home/storages"
  python3 - "$home/storages/story_runs.json" <<'PY'
import json, sys
json.dump({"tables": {"novels": {"n": {"runs": [{
  "id": "run_span", "status": "running", "attempts": [
    {"id": "span1", "status": "running", "childSessionId": "sess-span", "request": {"key": "stage/0"}},
  ],
}]}}}}, open(sys.argv[1], "w"))
PY
  cat >"$S/flip.sh" <<'EOF'
#!/bin/bash
sleep 0.5
python3 -c 'import json,os; p=os.environ["WD_HOME"]+"/storages/story_runs.json"; s=json.load(open(p)); s["tables"]["novels"]["n"]["runs"][0]["attempts"][0]["status"]="succeeded"; json.dump(s, open(p,"w"))'
EOF
  chmod +x "$S/flip.sh"
  env WD_STATE="$st" "$B/budget.sh" init >"$S/init.out"
  env WD_OFFLINE=1 WD_STATE="$st" WD_HOME="$home" WD_RUN_CMD="$S/flip.sh" WD_PARENT_JSONL="$S/run.jsonl" WD_POLL=10 \
    "$B/drive.sh" span >"$S/span.out" 2>&1
  echo $? >"$S/span.rc"
}

all=(reset_settled attempt_logs ledger_duplicate mutants corrupt_files live_run final_missing_log final_tokens final_calls completes_199 completes_200 limit_exact total_10m missing_ledger measure_fail realistic_poll2 realistic_poll20 kill9_resume ledger_persist usage_parse provider_env)
if [[ $# -eq 0 ]]; then
  sel=("${all[@]}")
else
  sel=("$@")
fi
for s in "${sel[@]}"; do
  rm -rf "${W:?}/$s"
  mkdir -p "$W/$s"
  "s_$s"
done
python3 "$M/evaluate.py" "$W" "${sel[@]}"
