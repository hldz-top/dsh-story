#!/usr/bin/env python3
"""Per-run call and uncached-input meter. Read-only over DSH homes. Never calls a model.

Uncached input is the only figure compared with WD_TOTAL_LIMIT. Token parsing lives in
usage.mjs so a missing or non-numeric usage cannot be stored as 0. cache_read and output
are printed for information and are not part of the limit.

Exit codes: 0 OK, 2 usage or provider configuration, 4 OVER_RUN, 5 OVER_TOTAL, 6 MEASURE_FAIL.
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

EXIT_OK = 0
EXIT_USAGE = 2
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


def node_bin():
    chosen = os.environ.get('WD_NODE')
    if chosen:
        return chosen
    found = shutil.which('node')
    if not found:
        raise MeasureFail('node is not on PATH; set WD_NODE')
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
    text = open(LEDGER, encoding='utf-8').read()
    lines = text.splitlines()
    if not lines or 'created=' not in lines[0] or 'start=0' not in lines[0] or not lines[0].startswith('# '):
        raise MeasureFail('ledger has no start=0 header; refusing to treat it as a zero baseline')
    created = lines[0].split('created=', 1)[1].split()[0]
    rows = {}
    for line in lines:
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) != 8:
            raise MeasureFail('ledger row does not have 8 columns')
        tag, home, calls, uncached, cache, output, status, ended = parts
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
    except (OSError, subprocess.TimeoutExpired) as cause:
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


def child_total(home):
    stdout = run_usage([home])
    total = None
    runs = []
    for line in stdout.splitlines():
        if line.startswith('RUN '):
            parts = line.split()
            if len(parts) < 3:
                raise MeasureFail(f'usage.mjs RUN line is malformed: {line}')
            runs.append(parts[1:3])
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
    }, runs


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
    return json.load(open(path, encoding='utf-8'))


def measure(tag, rows):
    base = load_base(tag)
    child, runs = child_total(base['home'])
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
        read_ledger()
        path = base_path(tag)
        if os.path.exists(path) and os.environ.get('WD_RESET') != '1':
            base = load_base(tag)
            if base['home'] != home:
                die(f'{tag} already has a base on {base["home"]}, not {home}; set WD_RESET=1 only for a brand-new run')
            print(f"reuse base {tag}: steps={base['base_steps']} input={base['base_in']} (resume keeps counting)")
            return
        child, runs = child_total(home)
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


def main():
    args = sys.argv[1:]
    if not args:
        die('usage: budget.sh provider | init | reset --confirm | start <tag> <home> <parent_jsonl> | <tag> | finish <tag> [status] | total | unfinished')
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
    if len(args) == 1:
        cmd_tag(args[0])
        return
    die('usage: budget.sh provider | init | reset --confirm | start <tag> <home> <parent_jsonl> | <tag> | finish <tag> [status] | total | unfinished')


if __name__ == '__main__':
    main()
