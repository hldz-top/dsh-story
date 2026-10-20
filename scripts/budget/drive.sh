#!/usr/bin/env bash
# Run one writing command under the budget watchdog.
#   WD_HOME          DSH home the run writes (required)
#   WD_RUN_CMD       executable started with the tag as its only argument (required)
#   WD_PARENT_JSONL  headless --json output (default: $WD_STATE/run-<tag>.jsonl)
#   WD_STATE         ledger directory (default: scripts/budget/state, gitignored)
#   WD_POLL          seconds between checks (default 2)
#   WD_SIGNAL_MATCH  ERE matched against descendant command lines (default: dsh --profile headless)
#   WD_GRACE         seconds before a second SIGINT (default 60). Never sends SIGKILL.
#   WD_RUN_LIMIT     per-run model calls (default 200; call 200 is allowed)
#   WD_TOTAL_LIMIT   cumulative uncached input tokens (default 10000000)
#   WD_OFFLINE=1     skip the Aliyun token-plan env check. Mock only; never for a real model.
# Exit: 0 run finished under the limits; 2 provider or arguments; 3 lock or another unfinished run;
#       4 OVER_RUN; 5 OVER_TOTAL; 6 MEASURE_FAIL. A watchdog stop replaces the run command's status.
set -u -o pipefail
ROOT=$(dirname "$(readlink -f "$0")")
tag=${1:?tag}
export WD_STATE=${WD_STATE:-$ROOT/state}
if [[ -z ${WD_HOME:-} ]]; then
  echo 'drive: WD_HOME is required (the DSH home this run writes)' >&2
  exit 2
fi
if [[ -z ${WD_RUN_CMD:-} ]]; then
  echo 'drive: WD_RUN_CMD is required (one executable; the tag is appended)' >&2
  exit 2
fi
HOME_DIR=$(readlink -f "$WD_HOME")
POLL=${WD_POLL:-2}
GRACE=${WD_GRACE:-60}
MATCH=${WD_SIGNAL_MATCH:-'(^|/)dsh --profile headless'}
mkdir -p "$WD_STATE"
PJ=${WD_PARENT_JSONL:-$WD_STATE/run-$tag.jsonl}
if [[ $PJ != /* ]]; then
  PJ=$PWD/$PJ
fi
LOG=$WD_STATE/$tag.drive.log
log() { printf '%s %s\n' "$(date '+%F %T.%3N %Z')" "$*" | tee -a "$LOG"; }
limit_name() {
  case $1 in
    OVER_RUN) printf 'per-run-calls WD_RUN_LIMIT=%s (call %s allowed; interrupt before %s)' \
      "${WD_RUN_LIMIT:-200}" "${WD_RUN_LIMIT:-200}" "$(( ${WD_RUN_LIMIT:-200} + 1 ))" ;;
    OVER_TOTAL) printf 'cumulative-uncached-input WD_TOTAL_LIMIT=%s (exactly %s allowed; %s stops; cache tokens excluded)' \
      "${WD_TOTAL_LIMIT:-10000000}" "${WD_TOTAL_LIMIT:-10000000}" "$(( ${WD_TOTAL_LIMIT:-10000000} + 1 ))" ;;
    MEASURE_FAIL) printf 'measurement (fail closed; a failed read is not zero)' ;;
    *) printf '%s' "$1" ;;
  esac
}
# Close the lock fd in children. Otherwise a meter process still holds it after kill -9
# and the next drive.sh cannot resume.
budget() { "$ROOT/budget.sh" "$@" 9>&-; }

if [[ ${WD_OFFLINE:-} == 1 ]]; then
  log 'offline mock: provider env check skipped (WD_OFFLINE=1); no model is called'
else
  provider_out=$(budget provider 2>&1) || provider_rc=$?
  provider_rc=${provider_rc:-0}
  printf '%s\n' "$provider_out" | tee -a "$LOG"
  if [[ $provider_rc -ne 0 ]]; then
    exit 2
  fi
fi

exec 9>"$WD_STATE/drive.lock"
if ! flock -n 9; then
  log "REFUSED: another drive.sh holds $WD_STATE/drive.lock (runs are serial)"
  exit 3
fi
live_out=$(budget live 2>&1) || live_rc=$?
live_rc=${live_rc:-0}
if [[ $live_rc -ne 0 ]]; then
  printf '%s\n' "$live_out" | tee -a "$LOG"
  if [[ $(tail -n 1 <<<"$live_out") == MEASURE_FAIL || $live_rc -eq 6 ]]; then
    log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $(head -n 1 <<<"$live_out")"
    exit 6
  fi
  log "REFUSED: $(head -n 1 <<<"$live_out")"
  exit 3
fi
open_out=$(budget unfinished 2>&1) || open_rc=$?
open_rc=${open_rc:-0}
printf '%s\n' "$open_out" | tee -a "$LOG"
if [[ $(tail -n 1 <<<"$open_out") == MEASURE_FAIL || $open_rc -eq 6 ]]; then
  log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $(head -n 1 <<<"$open_out")"
  exit 6
fi
open_runs=$(printf '%s\n' "$open_out" | tr ' ' '\n' | grep -vx "$tag" | tr '\n' ' ' || true)
if [[ -n ${open_runs// /} ]]; then
  log "REFUSED: runs without a ledger row: ${open_runs}- run 'budget.sh finish <tag>' for them first"
  exit 3
fi
total_out=$(budget total 2>&1) || total_rc=$?
total_rc=${total_rc:-0}
printf '%s\n' "$total_out" | tee -a "$LOG"
case $(tail -n 1 <<<"$total_out") in
  OK) ;;
  OVER_TOTAL)
    log "WATCHDOG OVER_TOTAL limit=$(limit_name OVER_TOTAL) $(head -n 1 <<<"$total_out")"
    exit 5 ;;
  *)
    log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $(head -n 1 <<<"$total_out")"
    exit 6 ;;
esac
start_out=$(budget start "$tag" "$HOME_DIR" "$PJ" 2>&1) || start_rc=$?
start_rc=${start_rc:-0}
printf '%s\n' "$start_out" | tee -a "$LOG"
if [[ $start_rc -ne 0 ]]; then
  if [[ $(tail -n 1 <<<"$start_out") == MEASURE_FAIL ]]; then
    log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $(head -n 1 <<<"$start_out")"
    exit 6
  fi
  log "REFUSED: $start_out"
  exit 3
fi
pre_out=$(budget "$tag" 2>&1) || true
printf '%s\n' "$pre_out" | tee -a "$LOG"
pre=$(tail -n 1 <<<"$pre_out")
case $pre in
  OK) ;;
  OVER_RUN)
    log "WATCHDOG OVER_RUN limit=$(limit_name OVER_RUN) $(head -n 1 <<<"$pre_out")"
    budget finish "$tag" "refused-OVER_RUN" >>"$LOG" 2>&1 || true
    exit 4 ;;
  OVER_TOTAL)
    log "WATCHDOG OVER_TOTAL limit=$(limit_name OVER_TOTAL) $(head -n 1 <<<"$pre_out")"
    budget finish "$tag" "refused-OVER_TOTAL" >>"$LOG" 2>&1 || true
    exit 5 ;;
  *)
    log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $(head -n 1 <<<"$pre_out")"
    exit 6 ;;
esac
if [[ -s $PJ ]]; then
  n=1
  while [[ -e $PJ.prev-$n ]]; do n=$((n + 1)); done
  mv "$PJ" "$PJ.prev-$n"
  log "archived parent output to $PJ.prev-$n"
fi

interrupt() {
  local all p c seen=" $pid " line
  local -a kids=("$pid") frontier=("$pid") hit=()
  all=$(ps -e -o pid=,ppid=,args=)
  while [[ ${#frontier[@]} -gt 0 ]]; do
    p=${frontier[0]}
    frontier=("${frontier[@]:1}")
    while IFS= read -r c; do
      [[ -n $c ]] || continue
      [[ $seen == *" $c "* ]] && continue
      seen+="$c "
      frontier+=("$c")
      kids+=("$c")
    done < <(awk -v pp="$p" '$2 == pp { print $1 }' <<<"$all")
  done
  for c in "${kids[@]}"; do
    line=$(awk -v id="$c" '$1 == id { $1=""; $2=""; print }' <<<"$all")
    if [[ $line =~ $MATCH ]]; then
      hit+=("$c")
    fi
  done
  if [[ ${#hit[@]} -eq 0 ]]; then
    log "no descendant matches '$MATCH'; SIGINT to process group $pid"
    kill -INT -- -"$pid" 2>/dev/null || true
  else
    log "SIGINT -> ${hit[*]}"
    kill -INT -- "${hit[@]}" 2>/dev/null || true
  fi
}

# python stays this pid across setsid and exec, so the recorded pid is the process-group leader.
python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$WD_RUN_CMD" "$tag" 9>&- &
pid=$!
begin_out=$(budget live-begin "$pid" "$tag" 2>&1) || begin_rc=$?
begin_rc=${begin_rc:-0}
if [[ $begin_rc -ne 0 ]]; then
  log "could not record the run process group: $begin_out"
  kill -INT -- -"$pid" 2>/dev/null || true
  if [[ $begin_rc -eq 3 ]]; then exit 3; fi
  log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $begin_out"
  exit 6
fi
log "started $WD_RUN_CMD $tag pid=$pid home=$HOME_DIR poll=${POLL}s"
log "$begin_out"
stopped=
stop_at=0
while kill -0 "$pid" 2>/dev/null; do
  sleep "$POLL" 9>&-
  kill -0 "$pid" 2>/dev/null || break
  out=$(budget "$tag" 2>&1) || true
  detail=$(head -n 1 <<<"$out")
  verdict=$(tail -n 1 <<<"$out")
  printf '%s %s\n' "$(date '+%F %T.%3N')" "$detail" >>"$LOG"
  case $verdict in
    OK) ;;
    OVER_RUN | OVER_TOTAL | MEASURE_FAIL) [[ -z $stopped ]] && stopped=$verdict ;;
    *) [[ -z $stopped ]] && stopped=MEASURE_FAIL; detail="unrecognized meter verdict: $out" ;;
  esac
  if [[ -n $stopped && $stop_at -eq 0 ]]; then
    log "WATCHDOG $stopped limit=$(limit_name "$stopped") $detail"
    {
      echo "$stopped"
      echo "WATCHDOG $stopped limit=$(limit_name "$stopped") $detail"
    } >"$WD_STATE/$tag.stop"
    interrupt
    stop_at=$(date +%s)
  elif [[ $stop_at -gt 0 && $(( $(date +%s) - stop_at )) -ge $GRACE ]]; then
    log "still running ${GRACE}s after SIGINT; second SIGINT (no SIGKILL)"
    interrupt
    stop_at=$(date +%s)
  fi
done
wait "$pid" || rc=$?
rc=${rc:-0}
log "run command exited $rc"
final_out=$(budget "$tag" 2>&1) || true
final_detail=$(head -n 1 <<<"$final_out")
final_verdict=$(tail -n 1 <<<"$final_out")
printf '%s final %s\n' "$(date '+%F %T.%3N')" "$final_detail" >>"$LOG"
case $final_verdict in
  MEASURE_FAIL)
    stopped=MEASURE_FAIL
    log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) $final_detail"
    ;;
  OVER_TOTAL)
    stopped=OVER_TOTAL
    log "WATCHDOG OVER_TOTAL limit=$(limit_name OVER_TOTAL) $final_detail"
    ;;
  OVER_RUN)
    if [[ ${stopped:-} != MEASURE_FAIL && ${stopped:-} != OVER_TOTAL ]]; then
      stopped=OVER_RUN
      log "WATCHDOG OVER_RUN limit=$(limit_name OVER_RUN) $final_detail"
    fi
    ;;
esac
finish_out=$(budget finish "$tag" "${stopped:-exit-$rc}" 2>&1) || finish_rc=$?
finish_rc=${finish_rc:-0}
printf '%s\n' "$finish_out" | tee -a "$LOG"
if [[ $finish_rc -ne 0 ]]; then
  log "WATCHDOG MEASURE_FAIL limit=$(limit_name MEASURE_FAIL) ledger finish failed: $(tail -n 1 <<<"$finish_out")"
  exit 6
fi
budget "$tag" 2>&1 | tee -a "$LOG" || true
case $stopped in
  OVER_RUN) exit 4 ;;
  OVER_TOTAL) exit 5 ;;
  MEASURE_FAIL) exit 6 ;;
  '') exit "$rc" ;;
esac
