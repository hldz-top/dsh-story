#!/usr/bin/env python3
"""Checks scripts/budget/mock/check.sh scenarios. Offline; no model calls."""
import json
import math
import os
import sys

W = sys.argv[1]
sel = sys.argv[2:]
RUN_LIMIT = 200
TOTAL = 10_000_000
ok_all = True


def text(path):
    return open(path, encoding='utf-8').read().strip() if os.path.exists(path) else ''


def tail(path):
    lines = text(path).splitlines()
    return lines[-1] if lines else ''


def head(path):
    lines = text(path).splitlines()
    return lines[0] if lines else ''


def ledger(path):
    rows = {}
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding='utf-8'):
        if not line.strip() or line.startswith('#'):
            continue
        tag, home, calls, uncached, cache, output, status, _ended = line.rstrip('\n').split('\t')
        rows[tag] = {
            'home': home,
            'calls': int(calls),
            'input': int(uncached),
            'cache': cache,
            'output': output,
            'status': status,
        }
    return rows


def load_json(path):
    if not os.path.exists(path):
        return None
    return json.loads(open(path, encoding='utf-8').read())


def run_status(scenario, home, run_id):
    store = load_json(f'{W}/{scenario}/{home}/storages/story_runs.json')
    for run in store['tables']['novels']['novel_mock']['runs']:
        if run['id'] == run_id:
            return run['status'], len(run['attempts'])
    return None, 0


def check(name, cond, detail):
    global ok_all
    ok_all = ok_all and bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}: {detail}")


def contains(path, needle):
    return needle in text(path)


def scenario_usage():
    base = f'{W}/usage_parse'
    check('no zero-default or provider fallback in the meter sources', text(f'{base}/grep.rc') == '0', 'grep.rc=' + text(f'{base}/grep.rc'))
    for name in ('batch-missing', 'batch-non-numeric', 'batch-prompt-bad', 'batch-prompt-missing'):
        check(f'{name} exits non-zero and prints no total', text(f'{base}/{name}.rc') not in ('', '0') and '"steps"' not in text(f'{base}/{name}.out'), f"rc={text(f'{base}/{name}.rc')} err={tail(f'{base}/{name}.err')}")
    zero = load_json(f'{base}/batch-zero.out')
    check('present inputTokens 0 is a real zero', text(f'{base}/batch-zero.rc') == '0' and zero and zero['steps'] == 1 and zero['input'] == 0, zero)
    both = load_json(f'{base}/batch-zero-and-five.out')
    check('a present zero is counted, then added to a later call', text(f'{base}/batch-zero-and-five.rc') == '0' and both and both['steps'] == 2 and both['input'] == 5, both)
    openai = load_json(f'{base}/batch-openai.out')
    check('prompt_tokens minus numeric cached_tokens', text(f'{base}/batch-openai.rc') == '0' and openai and openai['input'] == 1000 and openai['cacheRead'] == 500, openai)
    nodetails = load_json(f'{base}/batch-no-details.out')
    check('missing prompt_tokens_details counts every prompt_token', text(f'{base}/batch-no-details.rc') == '0' and nodetails and nodetails['input'] == 800 and nodetails['cacheRead'] is None, nodetails)
    ignored = load_json(f'{base}/batch-cache-ignored.out')
    check('cache_read is not added to uncached input', text(f'{base}/batch-cache-ignored.rc') == '0' and ignored and ignored['input'] == 10 and ignored['cacheRead'] == 50000000, ignored)
    for name in ('parent-missing', 'parent-non-numeric'):
        check(f'{name} is MEASURE_FAIL', text(f'{base}/{name}.rc') == '6' and tail(f'{base}/{name}.out') == 'MEASURE_FAIL', f"rc={text(f'{base}/{name}.rc')} {tail(f'{base}/{name}.out')}")
        rows = ledger(f'{base}/{name}/state/ledger.tsv')
        check(f'{name} does not record a zero row', list(rows) == ['start'] and rows['start']['input'] == 0, rows)
    check('parent inputTokens 0 is allowed', text(f'{base}/parent-zero.rc') == '0' and tail(f'{base}/parent-zero.out') == 'OK' and 'calls=1/200' in text(f'{base}/parent-zero.out') and 'uncached_input=0' in text(f'{base}/parent-zero.out'), tail(f'{base}/parent-zero.out'))
    check('parent OpenAI usage uses prompt_tokens, not inputTokens', text(f'{base}/parent-openai.rc') == '0' and 'uncached_input=1000' in text(f'{base}/parent-openai.out') and 'cache_read=500' in text(f'{base}/parent-openai.out'), head(f'{base}/parent-openai.out'))
    check('parent missing cache info is reported and still counts prompt_tokens', 'uncached_input=800' in text(f'{base}/parent-no-details.out') and 'cache_read=unknown' in text(f'{base}/parent-no-details.out') and tail(f'{base}/parent-no-details.out') == 'OK', head(f'{base}/parent-no-details.out'))
    check('parent cache_read does not trip the 10M limit', text(f'{base}/parent-cache.rc') == '0' and 'uncached_input=10' in text(f'{base}/parent-cache.out') and 'cache_read=50000000' in text(f'{base}/parent-cache.out') and tail(f'{base}/parent-cache.out') == 'OK', head(f'{base}/parent-cache.out'))
    check('exactly 10000000 uncached input is allowed', text(f'{base}/parent-boundary-at.rc') == '0' and 'cumulative_uncached_input=10000000 of 10000000' in text(f'{base}/parent-boundary-at.out') and tail(f'{base}/parent-boundary-at.out') == 'OK', tail(f'{base}/parent-boundary-at.out'))
    check('10000001 uncached input stops', text(f'{base}/parent-boundary-over.rc') == '5' and 'cumulative_uncached_input=10000001 of 10000000' in text(f'{base}/parent-boundary-over.out') and tail(f'{base}/parent-boundary-over.out') == 'OVER_TOTAL', tail(f'{base}/parent-boundary-over.out'))
    for name in ('child-missing', 'child-non-numeric'):
        check(f'{name} usage.mjs exits non-zero without TOTAL', text(f'{base}/{name}.usage.rc') not in ('', '0') and 'TOTAL' not in text(f'{base}/{name}.usage.out'), f"rc={text(f'{base}/{name}.usage.rc')} err={tail(f'{base}/{name}.usage.err')}")
        check(f'{name} meter is MEASURE_FAIL', text(f'{base}/{name}.rc') == '6' and tail(f'{base}/{name}.out') == 'MEASURE_FAIL', tail(f'{base}/{name}.out'))
    check('child present zero is a real zero', text(f'{base}/child-zero.usage.rc') == '0' and '"input":0' in text(f'{base}/child-zero.usage.out') and text(f'{base}/child-zero.rc') == '0' and 'uncached_input=0' in text(f'{base}/child-zero.out') and 'calls=1/200' in text(f'{base}/child-zero.out'), head(f'{base}/child-zero.out'))
    check('child OpenAI usage subtracts cached tokens', 'uncached_input=1000' in text(f'{base}/child-openai.out') and text(f'{base}/child-openai.usage.rc') == '0', head(f'{base}/child-openai.out'))


def scenario_provider():
    base = f'{W}/provider_env'
    for name in ('missing', 'only-url', 'only-key', 'blank'):
        err = text(f'{base}/{name}.err') + text(f'{base}/{name}.out')
        check(
            f'{name} is an explicit provider error',
            text(f'{base}/{name}.rc') == '2' and 'No fallback provider is configured' in err and 'http' not in err and 'dashscope' not in err and 'Authorization' not in err and 'sentinel-key-do-not-print' not in err and 'example.test' not in err,
            err,
        )
    missing = text(f'{base}/missing.err')
    check('missing names both variables', 'ALIYUN_TOKEN_PLAN_BASE_URL' in missing and 'ALIYUN_TOKEN_PLAN_API_KEY' in missing, missing)
    check('only-url names the missing key', 'missing ALIYUN_TOKEN_PLAN_API_KEY' in text(f'{base}/only-url.err'), text(f'{base}/only-url.err'))
    check('only-key names the missing url', 'missing ALIYUN_TOKEN_PLAN_BASE_URL' in text(f'{base}/only-key.err'), text(f'{base}/only-key.err'))
    ok = text(f'{base}/ok.out') + text(f'{base}/ok.err')
    check('configured provider prints neither the key nor the url', text(f'{base}/ok.rc') == '0' and 'is set' in ok and 'sentinel-key-do-not-print' not in ok and 'example.test' not in ok and 'Authorization' not in ok, ok)
    check('drive does not start a real run without the env', text(f'{base}/drive.rc') == '2' and not os.path.exists(f'{base}/ran') and 'No fallback provider is configured' in text(f'{base}/drive.out'), f"rc={text(f'{base}/drive.rc')}")


def scenario_missing():
    base = f'{W}/missing_ledger'
    check('a missing ledger refuses the run', text(f'{base}/drive-missing.rc') == '6' and 'MEASURE_FAIL' in text(f'{base}/drive-missing.out') and 'ledger is missing' in text(f'{base}/drive-missing.out') and not os.path.exists(f'{base}/ran-none'), text(f'{base}/drive-missing.rc'))
    check('an empty ledger is not a zero baseline', text(f'{base}/empty.rc') == '6' and 'MEASURE_FAIL' in text(f'{base}/empty.out') and text(f'{base}/empty-before') == text(f'{base}/empty-after'), tail(f'{base}/empty.out'))
    check('init records start=0', text(f'{base}/init.rc') == '0' and 'INIT ' in text(f'{base}/init.out') and 'start=0' in text(f'{base}/init.out') and text(f'{base}/total0.rc') == '0' and 'cumulative_uncached_input=0 of 10000000' in text(f'{base}/total0.out') and tail(f'{base}/total0.out') == 'OK', text(f'{base}/init.out'))
    check('init does not recreate an existing ledger', text(f'{base}/init2.rc') == '2' and text(f'{base}/ledger-after-init') == text(f'{base}/ledger-after-init2'), text(f'{base}/init2.err'))
    check('reset without --confirm does not archive', text(f'{base}/reset-no.rc') == '2' and 'requires --confirm' in text(f'{base}/reset-no.err'), text(f'{base}/reset-no.err'))
    archives = [name for name in os.listdir(f'{base}/life/state') if name.startswith('ledger.tsv.archived-')]
    check('reset --confirm archives the previous total and starts at 0', text(f'{base}/reset.rc') == '0' and 'previous_uncached_input=50' in text(f'{base}/reset.out') and 'RESET ' in text(f'{base}/reset.out') and len(archives) == 1 and 'cumulative_uncached_input=0 of 10000000' in text(f'{base}/total-reset.out') and tail(f'{base}/total-reset.out') == 'OK', text(f'{base}/reset.out'))
    log = text(f'{base}/life/state/ledger.log')
    check('init and reset are in the ledger log', 'INIT ' in log and 'start=0' in log and 'previous_uncached_input=50' in log, log)
    check('deleting the ledger does not recreate a zero', text(f'{base}/deleted.rc') == '6' and text(f'{base}/deleted.flag') == 'absent' and 'ledger is missing' in text(f'{base}/deleted.out'), text(f'{base}/deleted.flag'))


def scenario_persist():
    base = f'{W}/ledger_persist'
    first = ledger(f'{base}/after-first.tsv')
    duplicate = ledger(f'{base}/after-duplicate.tsv')
    check('duplicate finish keeps one row', first.get('t1', {}).get('input') == 1000 and duplicate.get('t1', {}).get('input') == 1000 and duplicate.get('t1', {}).get('calls') == 1 and 't2' not in duplicate, duplicate.get('t1'))
    crashed = ledger(f'{base}/after-crash.tsv')
    killed = ledger(f'{base}/after-kill.tsv')
    check('crash before the ledger write leaves the previous total', text(f'{base}/crash.rc') == '9' and 't2' not in crashed and crashed.get('t1', {}).get('input') == 1000, f"rc={text(f'{base}/crash.rc')} rows={list(crashed)}")
    check('kill -9 during the write section leaves the previous total', 't2' not in killed and killed.get('t1', {}).get('input') == 1000, list(killed))
    done = ledger(f'{base}/after-t2.tsv')
    again = ledger(f'{base}/after-t2-dup.tsv')
    check('finish after the crash records t2 once', done.get('t2', {}).get('input') == 2000 and again.get('t2', {}).get('input') == 2000 and again.get('t1', {}).get('input') == 1000, again.get('t2'))
    both = ledger(f'{base}/after-concurrent.tsv')
    check('concurrent finishes keep both rows', both.get('t3', {}).get('input') == 1000 and both.get('t4', {}).get('input') == 3000 and both.get('t1', {}).get('input') == 1000 and both.get('t2', {}).get('input') == 2000, {key: both[key]['input'] for key in both})
    same = ledger(f'{base}/after-same.tsv')
    check('concurrent finishes of one tag do not double count', same.get('t3', {}).get('input') == 1000 and same.get('t3', {}).get('calls') == 1 and sum(row['input'] for row in same.values()) == 7000, same.get('t3'))
    check('the start=0 row survives', same.get('start', {}).get('input') == 0 and same.get('start', {}).get('status') == 'start=0', same.get('start'))


def scenario_runs(name):
    if name == 'usage_parse':
        scenario_usage()
        return
    if name == 'provider_env':
        scenario_provider()
        return
    if name == 'missing_ledger':
        scenario_missing()
        return
    if name == 'ledger_persist':
        scenario_persist()
        return
    if name == 'limit_exact':
        truth = load_json(f'{W}/{name}/r1.truth.json')
        status, attempts = run_status(name, 'home', truth['runId'])
        first = ledger(f'{W}/{name}/ledger-after-first.tsv').get('r1', {})
        check('call 200 is logged and call 201 is not', truth['completedAtSigint'] == RUN_LIMIT and truth['completed'] == RUN_LIMIT, f"completed={truth['completed']} at SIGINT={truth['completedAtSigint']}")
        check('SIGINT before the next call', head(f'{W}/{name}/r1-first.stop') == 'OVER_RUN' and truth['exit'] == 130 and text(f'{W}/{name}/r1-first.rc') == '4', f"stop={head(f'{W}/{name}/r1-first.stop')} exit={truth['exit']} drive={text(f'{W}/{name}/r1-first.rc')}")
        check('the limit that fired is named with the numbers', 'WATCHDOG OVER_RUN' in text(f'{W}/{name}/r1-first.out') and 'per-run-calls' in text(f'{W}/{name}/r1-first.out') and 'calls=200/200' in text(f'{W}/{name}/r1-first.out'), 'logged')
        check('ledger matches the interrupted run', first.get('calls') == RUN_LIMIT, first)
        check('the run stays resumable', status == 'running' and attempts > 0, f'status={status} attempts={attempts}')
        check('resume at the limit is refused', text(f'{W}/{name}/r1-resume.rc') == '4' and 'WATCHDOG OVER_RUN' in text(f'{W}/{name}/r1-resume.out'), text(f'{W}/{name}/r1-resume.rc'))
        resumed = load_json(f'{W}/{name}/r1-resume210.truth.json')
        final = ledger(f'{W}/{name}/state/ledger.tsv')['r1']
        check('a higher limit resumes from 200 without double counting', resumed['resumed'] and resumed['runId'] == truth['runId'] and resumed['completed'] >= 10 and final['calls'] == RUN_LIMIT + resumed['completed'] and head(f'{W}/{name}/state/r1.stop') == 'OVER_RUN', f"added={resumed['completed']} ledger={final['calls']}")
        return
    if name in ('completes_199', 'completes_200'):
        count = int(name[-3:])
        truth = load_json(f'{W}/{name}/r1.truth.json')
        status, _attempts = run_status(name, 'home', truth['runId'])
        row = ledger(f'{W}/{name}/state/ledger.tsv').get('r1', {})
        check(f'a run of exactly {count} calls finishes', truth['completed'] == count and status == 'completed' and row.get('calls') == count, f"completed={truth['completed']} status={status} ledger={row} drive={text(f'{W}/{name}/r1.rc')}")
        if count == 199:
            check('199 calls are not interrupted', not os.path.exists(f'{W}/{name}/state/r1.stop') and text(f'{W}/{name}/r1.rc') == '0' and row.get('status') == 'exit-0', text(f'{W}/{name}/r1.rc'))
        return
    if name.startswith('realistic'):
        truth = load_json(f'{W}/{name}/r1.truth.json')
        poll = 20 if name.endswith('20') else 2
        over = truth['completedAtSigint'] - RUN_LIMIT
        bound = math.ceil((poll + 10) * (2 / 2.5)) + 2
        check('OVER_RUN names the per-run call limit', head(f'{W}/{name}/state/r1.stop') == 'OVER_RUN' and 'WATCHDOG OVER_RUN' in text(f'{W}/{name}/r1.out') and 'per-run-calls' in text(f'{W}/{name}/r1.out'), f"overshoot={over} sent={truth['started']} in_flight={truth['inFlightAtSigint']}")
        check(f'completed overshoot is within about one {poll}s poll', 0 <= over <= bound and (over >= 1 or poll == 2), f'overshoot={over} bound={bound}')
        print(f"  [INFO] poll={poll}s completed_overshoot={over} bound={bound} in_flight={truth['inFlightAtSigint']} sent={truth['started']}")
        return
    if name == 'total_10m':
        rows = ledger(f'{W}/{name}/state/ledger.tsv')
        for index in (1, 2):
            check(f'r{index} completes at 5000000', rows.get(f'r{index}', {}).get('status') == 'exit-0' and rows.get(f'r{index}', {}).get('input') == 5_000_000, rows.get(f'r{index}'))
        check('two runs land exactly on 10000000', rows['r1']['input'] + rows['r2']['input'] == TOTAL, rows['r1']['input'] + rows['r2']['input'])
        truth = load_json(f'{W}/{name}/r3.truth.json')
        cumulative = TOTAL + rows['r3']['input']
        check('the next run stops over 10000000', head(f'{W}/{name}/state/r3.stop') == 'OVER_TOTAL' and 'WATCHDOG OVER_TOTAL' in text(f'{W}/{name}/r3.out') and 'cumulative-uncached-input' in text(f'{W}/{name}/r3.out') and cumulative >= TOTAL + 1 and truth['completedAtSigint'] < 40, f"r3={rows['r3']['input']} cumulative={cumulative} completed={truth['completedAtSigint']} drive={text(f'{W}/{name}/r3.rc')}")
        check('a further run is refused before it starts', text(f'{W}/{name}/r4.rc') == '5' and not os.path.exists(f'{W}/{name}/r4.truth.json') and 'WATCHDOG OVER_TOTAL' in text(f'{W}/{name}/r4.out'), text(f'{W}/{name}/r4.rc'))
        return
    if name == 'measure_fail':
        check('a failed measurement stops the run', text(f'{W}/{name}/r1.rc') == '6' and head(f'{W}/{name}/state/r1.stop') == 'MEASURE_FAIL' and 'WATCHDOG MEASURE_FAIL' in text(f'{W}/{name}/r1.out') and 'limit=measurement' in text(f'{W}/{name}/r1.out'), f"rc={text(f'{W}/{name}/r1.rc')} stop={head(f'{W}/{name}/state/r1.stop')}")
        return
    if name == 'reset_settled':
        before = text(f'{W}/{name}/ledger-before')
        after = text(f'{W}/{name}/ledger-after')
        err = text(f'{W}/{name}/reset.err')
        check('WD_RESET of a settled tag is refused and the ledger stays', text(f'{W}/{name}/reset.rc') == '2' and 'new tag' in err and '6000000' in text(f'{W}/{name}/finish.out') and before == after and text(f'{W}/{name}/base-before') == text(f'{W}/{name}/base-after'), err)
        return
    if name == 'attempt_logs':
        check('already-terminal attempts without logs are not failures', text(f'{W}/{name}/open.rc') == '0' and tail(f'{W}/{name}/open.out') == 'OK' and 'calls=0/200' in text(f'{W}/{name}/open.out'), tail(f'{W}/{name}/open.out'))
        check('an attempt running at start and terminal later without a log fails', text(f'{W}/{name}/span.rc') == '6' and '1 terminal attempts have no session log' in text(f'{W}/{name}/span.err') + text(f'{W}/{name}/span.out'), text(f'{W}/{name}/span.err'))
        check('a new terminal attempt without a log is counted too', text(f'{W}/{name}/two.rc') == '6' and '2 terminal attempts have no session log' in text(f'{W}/{name}/two.err') + text(f'{W}/{name}/two.out'), text(f'{W}/{name}/two.err'))
        return
    if name == 'ledger_duplicate':
        blob = text(f'{W}/{name}/total.out') + text(f'{W}/{name}/total.err')
        check('duplicate ledger rows are MEASURE_FAIL', text(f'{W}/{name}/total.rc') == '6' and 'duplicate rows for t1' in blob and 'Traceback' not in blob and tail(f'{W}/{name}/total.out') == 'MEASURE_FAIL', blob)
        return
    if name == 'mutants':
        check('non-numeric cached_tokens is MEASURE_FAIL', text(f'{W}/{name}/batch-bad-cached.rc') not in ('', '0') and '"steps"' not in text(f'{W}/{name}/batch-bad-cached.out'), text(f'{W}/{name}/batch-bad-cached.err'))
        check('cached_tokens above prompt_tokens is MEASURE_FAIL', text(f'{W}/{name}/batch-cached-over.rc') not in ('', '0') and 'exceeds prompt_tokens' in text(f'{W}/{name}/batch-cached-over.err'), text(f'{W}/{name}/batch-cached-over.err'))
        blob = text(f'{W}/{name}/below.out') + text(f'{W}/{name}/below.err')
        check('child usage below the base is MEASURE_FAIL', text(f'{W}/{name}/below.rc') == '6' and 'below the base' in blob and tail(f'{W}/{name}/below.out') == 'MEASURE_FAIL', blob)
        return
    if name == 'corrupt_files':
        for label, needle in (('utf', 'not valid UTF-8'), ('empty', 'created= is empty'), ('base', 'not JSON')):
            blob = text(f'{W}/{name}/{label}.out') + text(f'{W}/{name}/{label}.err')
            rc = text(f'{W}/{name}/{label}.rc')
            check(f'{label} corruption is MEASURE_FAIL', rc == '6' and needle in blob and 'Traceback' not in blob and rc != '0', blob)
        return
    if name == 'live_run':
        check('matching pid and starttime is alive', text(f'{W}/{name}/real.rc') == '3' and 'RUN_ALIVE' in text(f'{W}/{name}/real.out'), text(f'{W}/{name}/real.out'))
        forged = text(f'{W}/{name}/forged.out') + text(f'{W}/{name}/forged.err') + text(f'{W}/{name}/forged-finish.out') + text(f'{W}/{name}/forged-finish.err')
        check('a reused pid with a different starttime is not alive', text(f'{W}/{name}/forged.rc') == '0' and 'CLEAR' in text(f'{W}/{name}/forged.out') and 'still alive' not in forged and text(f'{W}/{name}/forged-finish.rc') != '3', forged)
        check('finish is refused while the recorded process is alive', text(f'{W}/{name}/alive-finish.rc') == '3' and 'still alive' in text(f'{W}/{name}/alive-finish.err'), text(f'{W}/{name}/alive-finish.err'))
        check('a dead process group is clear', text(f'{W}/{name}/dead.rc') == '0' and 'CLEAR' in text(f'{W}/{name}/dead.out'), text(f'{W}/{name}/dead.out'))
        check('kill -9 of drive.sh leaves the run blocking a new start and finish', text(f'{W}/{name}/other-start.rc') == '3' and text(f'{W}/{name}/held-finish.rc') == '3' and text(f'{W}/{name}/other-drive.rc') == '3' and 'still alive' in text(f'{W}/{name}/other-start.err') + text(f'{W}/{name}/held-finish.err') + text(f'{W}/{name}/other-drive.out'), text(f'{W}/{name}/other-drive.out'))
        check('after the run exits, start and finish are allowed', text(f'{W}/{name}/after-start.rc') == '0' and text(f'{W}/{name}/after-finish.rc') == '0' and 'still alive' not in text(f'{W}/{name}/after-start.err') + text(f'{W}/{name}/after-finish.err'), f"start={text(f'{W}/{name}/after-start.rc')} finish={text(f'{W}/{name}/after-finish.rc')} {text(f'{W}/{name}/after-finish.err')}")
        return
    if name == 'final_calls':
        row = ledger(f'{W}/{name}/state/ledger.tsv').get('r1', {})
        truth = load_json(f'{W}/{name}/r1.truth.json')
        check('ending past 200 calls before the next poll exits 4', text(f'{W}/{name}/r1.rc') == '4' and truth and truth['completed'] == 230 and truth['exit'] == 0 and row.get('calls') == 230 and 'WATCHDOG OVER_RUN' in text(f'{W}/{name}/r1.out'), f"rc={text(f'{W}/{name}/r1.rc')} truth={truth} ledger={row}")
        return
    if name == 'final_tokens':
        row = ledger(f'{W}/{name}/state/ledger.tsv').get('r1', {})
        check('ending past 10000000 tokens before the next poll exits 5', text(f'{W}/{name}/r1.rc') == '5' and row.get('input') == 12_000_000 and row.get('calls') == 3 and 'WATCHDOG OVER_TOTAL' in text(f'{W}/{name}/r1.out'), f"rc={text(f'{W}/{name}/r1.rc')} ledger={row}")
        return
    if name == 'final_missing_log':
        rows = ledger(f'{W}/{name}/state/ledger.tsv')
        blob = text(f'{W}/{name}/span.out') + text(f'{W}/{name}/span.err')
        check('final measurement fails closed on a terminal attempt with no log', text(f'{W}/{name}/span.rc') == '6' and '1 terminal attempts have no session log' in blob and 'span' not in rows, f"rc={text(f'{W}/{name}/span.rc')} rows={list(rows)} {blob[-400:]}")
        return
    if name == 'kill9_resume':
        before = ledger(f'{W}/{name}/ledger-before-kill.tsv')
        after = ledger(f'{W}/{name}/ledger-after-kill.tsv')
        resumed = ledger(f'{W}/{name}/ledger-after-resume.tsv')
        duplicate = ledger(f'{W}/{name}/ledger-after-dup.tsv')
        snapshot = text(f'{W}/{name}/calls-before.txt')
        seen = int(snapshot.split('calls=', 1)[1].split('/', 1)[0]) if 'calls=' in snapshot else -1
        check('kill -9 leaves the finished total in place', before.get('r0', {}).get('input') == 2000 and after.get('r0', {}).get('input') == 2000 and 'r1' not in after and text(f'{W}/{name}/total-after-kill.rc') == '0' and 'cumulative_uncached_input=2000 of 10000000' in text(f'{W}/{name}/total-after-kill.out'), f"before={before.get('r0')} after={list(after)} seen={seen}")
        check('resume keeps counting and does not double the killed run', seen >= 2 and resumed.get('r0', {}).get('input') == 2000 and resumed.get('r1', {}).get('calls', 0) > seen and duplicate.get('r1', {}).get('input') == resumed.get('r1', {}).get('input') and duplicate.get('r1', {}).get('calls') == resumed.get('r1', {}).get('calls'), f"seen={seen} resumed={resumed.get('r1')} r0={resumed.get('r0')}")
        return
    check(f'no evaluator for {name}', False, name)


for scenario in sel:
    print(f'== {scenario}')
    try:
        scenario_runs(scenario)
    except Exception as cause:
        ok_all = False
        print(f'  [FAIL] {scenario} raised {type(cause).__name__}: {cause}')

print('ALL PASS' if ok_all else 'SOME CHECKS FAILED')
sys.exit(0 if ok_all else 1)
