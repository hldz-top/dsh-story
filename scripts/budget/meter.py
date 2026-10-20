#!/usr/bin/env python3
"""Per-run call and uncached-input meter. Read-only over DSH homes. Never calls a model.

Uncached input is the only figure compared with WD_TOTAL_LIMIT. Token parsing lives in
usage.mjs so a missing or non-numeric usage cannot be stored as 0. cache_read and output
are printed for information and are not part of the limit.

Exit codes: 0 OK, 2 usage or provider configuration, 3 run still alive, 4 OVER_RUN, 5 OVER_TOTAL, 6 MEASURE_FAIL.
"""
import fcntl
import glob
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.environ.get('WD_STATE', os.path.join(ROOT, 'state'))
USAGE = os.environ.get('WD_USAGE', os.path.join(ROOT, 'usage.mjs'))
LEDGER = os.path.join(STATE, 'ledger.tsv')
LOG = os.path.join(STATE, 'ledger.log')
LIVE = os.path.join(STATE, 'live-run.json')

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_ALIVE = 3
EXIT_OVER_RUN = 4
EXIT_OVER_TOTAL = 5
EXIT_MEASURE = 6

PROVIDER_VARS = ('ALIYUN_TOKEN_PLAN_BASE_URL', 'ALIYUN_TOKEN_PLAN_API_KEY')


class MeasureFail(Exception):
    pass


def die(message, code=EXIT_USAGE):
    print(message, file=sys.stderr)
    sys.exit(code)


def env_int(name, default):
    raw = os.environ.get(name, default)
    if not str(raw).isdigit() or str(raw) != str(int(raw)):
        die(f'{name} must be a non-negative integer')
    return int(raw)


RUN_LIMIT = env_int('WD_RUN_LIMIT', '200')
TOTAL_LIMIT = env_int('WD_TOTAL_LIMIT', '10000000')


def fail_measure(message):
    print(f'MEASURE-FAIL {message}')
    print('MEASURE_FAIL')
    sys.exit(EXIT_MEASURE)


NODE_BIN = None


def node_version(binary):
    try:
        proc = subprocess.run([binary, '-p', 'process.versions.node'], capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as cause:
        raise MeasureFail(f'cannot read the node version: {cause}') from cause
    if proc.returncode != 0:
        raise MeasureFail(f'cannot read the node version: {proc.stderr.strip()}')
    parts = proc.stdout.strip().split('.')
    if len(parts) < 2:
        raise MeasureFail(f'node reported an unreadable version {proc.stdout.strip()!r}')
    try:
        return int(parts[0]), int(parts[1])
    except ValueError as cause:
        raise MeasureFail(f'node reported an unreadable version {proc.stdout.strip()!r}') from cause


def node_bin():
    global NODE_BIN
    if NODE_BIN:
        return NODE_BIN
    chosen = os.environ.get('WD_NODE')
    found = chosen or shutil.which('node')
    if not found:
        raise MeasureFail('node is not on PATH; set WD_NODE to Node >= 22.15')
    major, minor = node_version(found)
    if (major, minor) < (22, 15):
        raise MeasureFail(f'node {major}.{minor} is older than 22.15; set WD_NODE to Node >= 22.15')
    NODE_BIN = found
    return found


def iso_now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def stamp():
    moment = time.time()
    return time.strftime('%Y%m%dT%H%M%S', time.gmtime(moment)) + f'{int(moment * 1000) % 1000:03d}Z'


def locked(action):
    os.makedirs(STATE, exist_ok=True)
    with open(os.path.join(STATE, 'ledger.lock'), 'a+', encoding='utf-8') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            return action()
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def atomic_write(path, text):
    temporary = path + '.tmp'
    with open(temporary, 'w', encoding='utf-8') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    directory = os.open(os.path.dirname(os.path.abspath(path)), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def log_event(line):
    with open(LOG, 'a', encoding='utf-8') as handle:
        handle.write(line + '\n')
        handle.flush()
        os.fsync(handle.fileno())


def fmt(value):
    return 'unknown' if value is None else str(value)


def parse_count(value, label, allow_unknown=False):
    if allow_unknown and value == '-':
        return None
    if not isinstance(value, str) or not value.isdigit():
        raise MeasureFail(f'ledger {label} is not a non-negative integer')
    return int(value)


def read_ledger():
    if not os.path.exists(LEDGER):
        raise MeasureFail(
            'ledger is missing; refusing to treat the cumulative total as 0. '
            'Run `budget.sh init` to create a start=0 ledger. Deleting the file does not reset the budget.'
        )
    try:
        text = open(LEDGER, encoding='utf-8').read()
    except UnicodeDecodeError as cause:
        raise MeasureFail(f'ledger is not valid UTF-8: {cause}') from cause
    except OSError as cause:
        raise MeasureFail(f'ledger cannot be read: {cause}') from cause
    lines = text.splitlines()
    if not lines or 'created=' not in lines[0] or 'start=0' not in lines[0] or not lines[0].startswith('# '):
        raise MeasureFail('ledger has no start=0 header; refusing to treat it as a zero baseline')
    created_field = lines[0].split('created=', 1)[1].strip().split()
    if not created_field or created_field[0] == 'start=0':
        raise MeasureFail('ledger header created= is empty')
    created = created_field[0]
    rows = {}
    for line in lines:
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) != 8:
            raise MeasureFail('ledger row does not have 8 columns')
        tag, home, calls, uncached, cache, output, status, ended = parts
        if tag in rows:
            raise MeasureFail(f'ledger has duplicate rows for {tag}')
        rows[tag] = {
            'tag': tag,
            'home': home,
            'calls': parse_count(calls, 'calls'),
            'input': parse_count(uncached, 'uncached_input'),
            'cache_read': parse_count(cache, 'cache_read', allow_unknown=True),
            'output': parse_count(output, 'output', allow_unknown=True),
            'status': status,
            'ended': ended,
        }
    start = rows.get('start')
    if start is None or start['status'] != 'start=0' or start['input'] != 0 or start['calls'] != 0:
        raise MeasureFail('ledger has no start=0 entry; refusing to treat the cumulative total as 0')
    return created, rows


def ordered(rows):
    keys = ['start'] + sorted(key for key in rows if key != 'start')
    return [rows[key] for key in keys]


def ledger_text(created, rows):
    lines = [
        f'# created={created} start=0',
        '# tag\thome\tcalls\tuncached_input\tcache_read\toutput\tstatus\tended',
    ]
    for row in ordered(rows):
        lines.append('\t'.join([
            row['tag'], row['home'], str(row['calls']), str(row['input']),
            fmt(row['cache_read']) if row['cache_read'] is not None else '-',
            fmt(row['output']) if row['output'] is not None else '-',
            row['status'], row['ended'],
        ]))
    return '\n'.join(lines) + '\n'


def write_ledger(created, rows):
    atomic_write(LEDGER, ledger_text(created, rows))


def blank_ledger(created):
    return {
        'start': {
            'tag': 'start', 'home': '-', 'calls': 0, 'input': 0,
            'cache_read': 0, 'output': 0, 'status': 'start=0', 'ended': created,
        },
    }


def check_tag(tag):
    if tag == 'start' or not tag or any(char in tag for char in ' \t\n/\\'):
        die(f'refusing tag {tag!r}')


def run_usage(args, payload=None):
    try:
        proc = subprocess.run(
            [node_bin(), USAGE, *args],
            input=payload,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired as cause:
        raise MeasureFail('usage.mjs timed out after 60s; refusing a partial count') from cause
    except OSError as cause:
        raise MeasureFail(f'usage.mjs failed to run: {cause}') from cause
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip().splitlines()
        raise MeasureFail(detail[-1] if detail else f'usage.mjs exit {proc.returncode}')
    return proc.stdout


def as_int(value, label):
    if type(value) is not int:
        raise MeasureFail(f'{label} is missing or not numeric')
    if value < 0:
        raise MeasureFail(f'{label} is negative')
    return value


def as_optional(value, label):
    if value is None:
        return None
    return as_int(value, label)


def child_total(home, snapshot=None):
    args = [home]
    payload = None
    if snapshot is not None:
        args.append('--check-snapshot')
        payload = json.dumps({'attempts': snapshot})
    stdout = run_usage(args, payload)
    total = None
    runs = []
    attempts = []
    for line in stdout.splitlines():
        if line.startswith('RUN '):
            parts = line.split()
            if len(parts) < 3:
                raise MeasureFail(f'usage.mjs RUN line is malformed: {line}')
            runs.append(parts[1:3])
        elif line.startswith('ATTEMPT '):
            try:
                item = json.loads(line.split(' ', 1)[1])
            except ValueError as cause:
                raise MeasureFail(f'usage.mjs ATTEMPT line is not JSON: {cause}') from cause
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not isinstance(item.get('status'), str):
                raise MeasureFail(f'usage.mjs ATTEMPT line is missing id or status: {line}')
            attempts.append({'id': item['id'], 'status': item['status']})
        elif line.startswith('TOTAL '):
            try:
                total = json.loads(line.split(' ', 1)[1])
            except ValueError as cause:
                raise MeasureFail(f'usage.mjs TOTAL is not JSON: {cause}') from cause
    if not isinstance(total, dict):
        raise MeasureFail('usage.mjs printed no TOTAL line')
    return {
        'steps': as_int(total.get('steps'), 'child steps'),
        'input': as_int(total.get('input'), 'child uncached input'),
        'cache_read': as_optional(total.get('cacheRead'), 'child cache_read'),
        'output': as_optional(total.get('output'), 'child output'),
    }, runs, attempts


def sum_usages(usages):
    if not usages:
        return {'steps': 0, 'input': 0, 'cache_read': 0, 'output': 0}
    stdout = run_usage(['--batch'], json.dumps({'usages': usages}))
    try:
        total = json.loads(stdout)
    except ValueError as cause:
        raise MeasureFail(f'usage.mjs batch is not JSON: {cause}') from cause
    return {
        'steps': as_int(total.get('steps'), 'parent steps'),
        'input': as_int(total.get('input'), 'parent uncached input'),
        'cache_read': as_optional(total.get('cacheRead'), 'parent cache_read'),
        'output': as_optional(total.get('output'), 'parent output'),
    }


def usage_field_present(obj):
    if not isinstance(obj, dict):
        return False
    if 'usage' in obj:
        return True
    data = obj.get('data')
    if isinstance(data, dict):
        if 'usage' in data:
            return True
        message = data.get('message')
        if isinstance(message, dict) and 'usage' in message:
            return True
    return False


def usage_from_step(obj):
    if not isinstance(obj, dict):
        return None
    if 'usage' in obj:
        return obj['usage']
    data = obj.get('data')
    if isinstance(data, dict):
        if 'usage' in data:
            return data['usage']
        message = data.get('message')
        if isinstance(message, dict) and 'usage' in message:
            return message['usage']
    return None


def parent_usages(jsonl):
    usages = []
    paths = []
    if os.path.isfile(jsonl):
        paths.append(jsonl)
    paths.extend(sorted(glob.glob(glob.escape(jsonl) + '.prev-*')))
    for path in paths:
        with open(path, encoding='utf-8', errors='replace') as handle:
            lines = handle.read().splitlines()
        for index, line in enumerate(lines):
            if '"step_end"' not in line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                if index == len(lines) - 1:
                    continue
                raise MeasureFail(f'parent step_end line is not JSON: {path}') from None
            if usage_from_step(obj) is None and not usage_field_present(obj):
                usages.append(None)
                continue
            usages.append(usage_from_step(obj))
    return usages


def combine(left, left_steps, right, right_steps):
    if left_steps == 0 and right_steps == 0:
        return 0
    if left_steps == 0:
        return right
    if right_steps == 0:
        return left
    if left is None or right is None:
        return None
    return left + right


def extra_calls(tag):
    path = os.path.join(STATE, f'{tag}.extra')
    if not os.path.exists(path):
        return 0
    raw = open(path, encoding='utf-8').read().strip()
    if not raw.isdigit():
        raise MeasureFail(f'{tag}.extra is not a non-negative integer')
    return int(raw)


def base_path(tag):
    return os.path.join(STATE, f'{tag}.base.json')


def load_base(tag):
    path = base_path(tag)
    if not os.path.exists(path):
        die(f'no base for {tag}: run `budget.sh start {tag} <home> <parent_jsonl>` first')
    try:
        return json.load(open(path, encoding='utf-8'))
    except UnicodeDecodeError as cause:
        raise MeasureFail(f'base for {tag} is not valid UTF-8: {cause}') from cause
    except json.JSONDecodeError as cause:
        raise MeasureFail(f'base for {tag} is not JSON: {cause}') from cause
    except OSError as cause:
        raise MeasureFail(f'base for {tag} cannot be read: {cause}') from cause


def stat_fields(pid):
    """Read /proc/<pid>/stat. Field 5 is pgrp and field 22 is starttime, after the comm field."""
    try:
        data = open(f'/proc/{pid}/stat', 'rb').read()
    except FileNotFoundError:
        return None
    except OSError as cause:
        raise MeasureFail(f'cannot read /proc/{pid}/stat: {cause}') from cause
    end = data.rfind(b')')
    if end < 0:
        raise MeasureFail(f'/proc/{pid}/stat has no command field')
    rest = data[end + 2:].split()
    if len(rest) < 20:
        raise MeasureFail(f'/proc/{pid}/stat is truncated')
    try:
        return {'pgrp': int(rest[2]), 'starttime': int(rest[19])}
    except ValueError as cause:
        raise MeasureFail(f'/proc/{pid}/stat has a non-numeric field: {cause}') from cause


def read_live():
    if not os.path.exists(LIVE):
        return None
    try:
        data = json.loads(open(LIVE, encoding='utf-8').read())
    except UnicodeDecodeError as cause:
        raise MeasureFail(f'live-run record is not valid UTF-8: {cause}') from cause
    except json.JSONDecodeError as cause:
        raise MeasureFail(f'live-run record is not JSON: {cause}') from cause
    except OSError as cause:
        raise MeasureFail(f'live-run record cannot be read: {cause}') from cause
    if not isinstance(data, dict):
        raise MeasureFail('live-run record is not an object')
    for key in ('pid', 'pgid', 'starttime', 'tag'):
        if key not in data:
            raise MeasureFail(f'live-run record is missing {key}')
    for key in ('pid', 'pgid', 'starttime'):
        if type(data[key]) is not int:
            raise MeasureFail(f'live-run record {key} is not an integer')
    if not isinstance(data['tag'], str) or not data['tag']:
        raise MeasureFail('live-run record tag is empty')
    return data


def pgrp_has_process(pgid):
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        fields = None
        try:
            fields = stat_fields(int(name))
        except MeasureFail:
            continue
        if fields is not None and fields['pgrp'] == pgid:
            return True
    return False


def group_alive(record):
    """True when the recorded leader still has the same starttime, or that leader's process group remains.
    A reused pid with a different starttime is not this run. A process that was not the group leader
    does not keep the group alive after its own pid is gone.
    """
    fields = stat_fields(record['pid'])
    if fields is not None:
        if fields['starttime'] != record['starttime']:
            return False
        return True
    if record['pgid'] != record['pid']:
        return False
    return pgrp_has_process(record['pgid'])


def assert_no_live_run():
    record = read_live()
    if record is not None and group_alive(record):
        die(
            f"REFUSED: run still alive pid={record['pid']} pgid={record['pgid']} "
            f"starttime={record['starttime']} tag={record['tag']}. "
            'Not starting or finishing another run while that process group is alive.',
            EXIT_ALIVE,
        )


def measure(tag, rows):
    base = load_base(tag)
    if not isinstance(base.get('attempts_at_start'), list):
        raise MeasureFail(f'base for {tag} has no attempt snapshot')
    child, runs, _attempts = child_total(base['home'], base['attempts_at_start'])
    parent = sum_usages(parent_usages(base['parent_jsonl']))
    extra = extra_calls(tag)
    calls_delta = child['steps'] - base['base_steps']
    input_delta = child['input'] - base['base_in']
    if calls_delta < 0 or input_delta < 0:
        raise MeasureFail(f'child usage went below the base ({calls_delta}, {input_delta})')
    calls = calls_delta + parent['steps'] + extra
    uncached = input_delta + parent['input']
    if base.get('base_cache_known') and child['cache_read'] is not None:
        child_cache = child['cache_read'] - base['base_cache']
        if child_cache < 0:
            raise MeasureFail('child cache_read went below the base')
    elif child['steps'] == base['base_steps']:
        child_cache = 0
    else:
        child_cache = None
    if base.get('base_out_known') and child['output'] is not None:
        child_out = child['output'] - base['base_out']
        if child_out < 0:
            raise MeasureFail('child output went below the base')
    elif child['steps'] == base['base_steps']:
        child_out = 0
    else:
        child_out = None
    cache = combine(child_cache, calls_delta, parent['cache_read'], parent['steps'])
    output = combine(child_out, calls_delta, parent['output'], parent['steps'])
    others = sum(row['input'] for key, row in rows.items() if key != tag)
    others_cache_rows = [row['cache_read'] for key, row in rows.items() if key != tag]
    others_output_rows = [row['output'] for key, row in rows.items() if key != tag]
    cumulative_cache = None if cache is None or any(item is None for item in others_cache_rows) else cache + sum(others_cache_rows)
    cumulative_output = None if output is None or any(item is None for item in others_output_rows) else output + sum(others_output_rows)
    new_runs = [item[0] for item in runs if item[0] not in base.get('runs_at_start', [])]
    return {
        'tag': tag,
        'calls': calls,
        'child': calls_delta,
        'parent': parent['steps'],
        'extra': extra,
        'input': uncached,
        'cache_read': cache,
        'output': output,
        'cumulative': others + uncached,
        'cumulative_cache': cumulative_cache,
        'cumulative_output': cumulative_output,
        'new_runs': new_runs,
        'home': base['home'],
    }


def verdict_of(measured):
    if measured['cumulative'] > TOTAL_LIMIT:
        return 'OVER_TOTAL', EXIT_OVER_TOTAL
    if measured['calls'] >= RUN_LIMIT:
        return 'OVER_RUN', EXIT_OVER_RUN
    return 'OK', EXIT_OK


def detail_of(measured):
    return (
        f"run {measured['tag']}: calls={measured['calls']}/{RUN_LIMIT} "
        f"(child {measured['child']}, parent {measured['parent']}, extra {measured['extra']}); "
        f"uncached_input={measured['input']}; cache_read={fmt(measured['cache_read'])}; "
        f"output={fmt(measured['output'])}; "
        f"cumulative_uncached_input={measured['cumulative']} of {TOTAL_LIMIT}; "
        f"cumulative_cache_read={fmt(measured['cumulative_cache'])}; "
        f"cumulative_output={fmt(measured['cumulative_output'])}; "
        f"new_runs={measured['new_runs']}"
    )


def emit(measured):
    name, code = verdict_of(measured)
    print(detail_of(measured))
    print(name)
    sys.exit(code)


def cumulative_of(rows):
    uncached = sum(row['input'] for row in rows.values())
    caches = [row['cache_read'] for row in rows.values()]
    outputs = [row['output'] for row in rows.values()]
    cache = None if any(item is None for item in caches) else sum(caches)
    output = None if any(item is None for item in outputs) else sum(outputs)
    return uncached, cache, output


def unfinalized(rows):
    bases = []
    for path in glob.glob(os.path.join(STATE, '*.base.json')):
        name = os.path.basename(path)[: -len('.base.json')]
        bases.append(name)
    return sorted(tag for tag in bases if tag not in rows)


def cmd_provider():
    missing = [name for name in PROVIDER_VARS if not os.environ.get(name, '').strip()]
    if missing:
        die(
            'provider: missing '
            + ', '.join(missing)
            + '. Real-model calls use the Aliyun token plan and read only '
            + ' and '.join(PROVIDER_VARS)
            + '. No fallback provider is configured.'
        )
    print(
        'provider ok: Aliyun token plan (OpenAI-compatible); '
        'ALIYUN_TOKEN_PLAN_BASE_URL is set; ALIYUN_TOKEN_PLAN_API_KEY is set'
    )


def cmd_init():
    def action():
        if os.path.exists(LEDGER):
            die(f'ledger already exists at {LEDGER}; refusing to recreate it. Use `budget.sh reset --confirm` to archive it.')
        created = iso_now()
        write_ledger(created, blank_ledger(created))
        archives = sorted(glob.glob(LEDGER + '.archived-*'))
        note = ' archives_left_in_place=' + str(len(archives)) if archives else ''
        line = f'INIT {created} start=0 ledger={LEDGER}{note}'
        log_event(line)
        print(line)
    locked(action)


def cmd_reset(args):
    if args != ['--confirm']:
        die('reset requires --confirm. This archives the current ledger and writes a new start=0 ledger.')

    def action():
        if not os.path.exists(LEDGER):
            die('no ledger to reset; refusing to create a silent zero. Restore the file, or run `budget.sh init` for a new ledger.')
        created_old, rows = read_ledger()
        previous, _, _ = cumulative_of(rows)
        archive = f'{LEDGER}.archived-{stamp()}'
        atomic_write(archive, open(LEDGER, encoding='utf-8').read())
        created = iso_now()
        write_ledger(created, blank_ledger(created))
        line = f'RESET {created} previous_uncached_input={previous} archived={archive} start=0 previous_created={created_old}'
        log_event(line)
        print(line)
    try:
        locked(action)
    except MeasureFail as cause:
        fail_measure(cause)


def cmd_start(tag, home, parent):
    check_tag(tag)
    home = os.path.abspath(home)
    parent = os.path.abspath(parent)

    def action():
        assert_no_live_run()
        _created, rows = read_ledger()
        path = base_path(tag)
        if os.environ.get('WD_RESET') == '1' and tag in rows:
            die(
                f'{tag} already has a settled ledger row ({rows[tag]["input"]} uncached input). '
                'Refusing WD_RESET. Use a new tag so the recorded usage is kept.'
            )
        if os.path.exists(path) and os.environ.get('WD_RESET') != '1':
            base = load_base(tag)
            if base['home'] != home:
                die(f'{tag} already has a base on {base["home"]}, not {home}. Use a new tag.')
            print(f"reuse base {tag}: steps={base['base_steps']} input={base['base_in']} (resume keeps counting)")
            return
        child, runs, attempts = child_total(home)
        base = {
            'tag': tag,
            'home': home,
            'parent_jsonl': parent,
            'base_steps': child['steps'],
            'base_in': child['input'],
            'base_cache': child['cache_read'],
            'base_cache_known': child['cache_read'] is not None,
            'base_out': child['output'],
            'base_out_known': child['output'] is not None,
            'runs_at_start': [item[0] for item in runs],
            'attempts_at_start': attempts,
            'started': iso_now(),
        }
        temporary = path + '.tmp'
        with open(temporary, 'w', encoding='utf-8') as handle:
            json.dump(base, handle, indent=1)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        print(f"base {tag}: home={home} steps={child['steps']} input={child['input']} runs_at_start={len(runs)}")
    try:
        locked(action)
    except MeasureFail as cause:
        fail_measure(cause)


def cmd_finish(tag, status):
    check_tag(tag)

    def action():
        assert_no_live_run()
        created, rows = read_ledger()
        measured = measure(tag, rows)
        pause = os.environ.get('WD_LEDGER_PAUSE')
        if pause:
            time.sleep(float(pause))
        if os.environ.get('WD_CRASH_BEFORE_LEDGER_WRITE') == '1':
            print('CRASH before ledger write', file=sys.stderr)
            os._exit(9)
        rows[tag] = {
            'tag': tag,
            'home': measured['home'],
            'calls': measured['calls'],
            'input': measured['input'],
            'cache_read': measured['cache_read'],
            'output': measured['output'],
            'status': status,
            'ended': iso_now(),
        }
        write_ledger(created, rows)
        print(
            f"ledger {tag}: calls={measured['calls']} uncached_input={measured['input']} "
            f"cache_read={fmt(measured['cache_read'])} output={fmt(measured['output'])} "
            f"status={status} cumulative_uncached_input={measured['cumulative']}"
        )
    try:
        locked(action)
    except MeasureFail as cause:
        fail_measure(cause)


def cmd_total(kind):
    def action():
        _, rows = read_ledger()
        uncached, cache, output = cumulative_of(rows)
        open_tags = unfinalized(rows)
        if kind == 'unfinished':
            print(' '.join(open_tags))
            return
        for row in ordered(rows):
            print(
                f"  {row['tag']}\tcalls={row['calls']}\tuncached_input={row['input']}\t"
                f"cache_read={fmt(row['cache_read'])}\toutput={fmt(row['output'])}\t{row['status']}"
            )
        print(
            f"cumulative_uncached_input={uncached} of {TOTAL_LIMIT} "
            f"(uncached input only; cache_read excluded); "
            f"cache_read={fmt(cache)}; output={fmt(output)}; "
            f"unfinalized={' '.join(open_tags) if open_tags else 'none'}"
        )
        if uncached > TOTAL_LIMIT:
            print('OVER_TOTAL')
            sys.exit(EXIT_OVER_TOTAL)
        print('OK')
    try:
        locked(action)
    except MeasureFail as cause:
        fail_measure(cause)


def cmd_tag(tag):
    check_tag(tag)

    def action():
        _, rows = read_ledger()
        return measure(tag, rows)
    try:
        emit(locked(action))
    except MeasureFail as cause:
        fail_measure(cause)


def cmd_live():
    try:
        record = read_live()
        if record is not None and group_alive(record):
            print(
                f"RUN_ALIVE pid={record['pid']} pgid={record['pgid']} "
                f"starttime={record['starttime']} tag={record['tag']}"
            )
            sys.exit(EXIT_ALIVE)
    except MeasureFail as cause:
        fail_measure(cause)
    print('CLEAR')


def cmd_live_begin(pid_text, tag):
    check_tag(tag)
    if not str(pid_text).isdigit():
        die('live-begin requires a numeric pid')
    pid = int(pid_text)
    try:
        assert_no_live_run()
        fields = None
        for _ in range(50):
            fields = stat_fields(pid)
            if fields is not None and fields['pgrp'] == pid:
                break
            time.sleep(0.02)
        if fields is None or fields['pgrp'] != pid:
            fail_measure(f'run pid {pid} exited or did not become a process-group leader')
        record = {'pid': pid, 'pgid': fields['pgrp'], 'starttime': fields['starttime'], 'tag': tag}
        os.makedirs(STATE, exist_ok=True)
        atomic_write(LIVE, json.dumps(record) + '\n')
    except MeasureFail as cause:
        fail_measure(cause)
    print(f"live {tag}: pid={record['pid']} pgid={record['pgid']} starttime={record['starttime']}")


def main():
    args = sys.argv[1:]
    if not args:
        die('usage: budget.sh provider | init | reset --confirm | start <tag> <home> <parent_jsonl> | <tag> | finish <tag> [status] | total | unfinished | live | live-begin <pid> <tag>')
    command = args[0]
    if command == 'provider':
        cmd_provider()
        return
    if command == 'init':
        cmd_init()
        return
    if command == 'reset':
        cmd_reset(args[1:])
        return
    if command == 'start':
        if len(args) != 4:
            die('usage: budget.sh start <tag> <home> <parent_jsonl>')
        cmd_start(args[1], args[2], args[3])
        return
    if command == 'finish':
        if len(args) not in (2, 3):
            die('usage: budget.sh finish <tag> [status]')
        cmd_finish(args[1], args[2] if len(args) == 3 else 'ended')
        return
    if command == 'total':
        cmd_total('total')
        return
    if command == 'unfinished':
        cmd_total('unfinished')
        return
    if command == 'live':
        cmd_live()
        return
    if command == 'live-begin':
        if len(args) != 3:
            die('usage: budget.sh live-begin <pid> <tag>')
        cmd_live_begin(args[1], args[2])
        return
    if len(args) == 1:
        cmd_tag(args[0])
        return
    die('usage: budget.sh provider | init | reset --confirm | start <tag> <home> <parent_jsonl> | <tag> | finish <tag> [status] | total | unfinished | live | live-begin <pid> <tag>')


if __name__ == '__main__':
    main()
