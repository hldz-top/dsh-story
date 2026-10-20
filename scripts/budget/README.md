# Budget watchdog

Dev-only tooling that stops a real-model writing run before it walks past a per-run call cap or a cumulative uncached-input cap. It does not call a model, does not read a provider response itself, and is not part of the published npm package or of `npm test`.

`package.json` publishes an allowlist (`files`: `lib`, `cordis.patch.yml`, `README.md`, `LICENSE`). Nothing under `scripts/budget/` is on that list. `npm pack --dry-run` should show no `scripts/budget` path.

## Limits

| Limit | Default | Environment | What happens |
| --- | --- | --- | --- |
| Model calls in one run | 200 | `WD_RUN_LIMIT` | Call 200 is allowed. Once the meter sees 200 logged calls it reports `OVER_RUN` and the driver sends SIGINT so call 201 should not finish. |
| Cumulative uncached input tokens | 10000000 | `WD_TOTAL_LIMIT` | Exactly 10,000,000 is allowed. 10,000,001 is `OVER_TOTAL`. Cache-read and output tokens are not part of this limit. |

Both figures are per the ledger described below. The cumulative total starts only when someone runs `budget.sh init`. It is not seeded from older homes.

## What is counted

The 10,000,000 cap is **uncached input tokens only**. Each measured call also prints cache-read and output totals when those fields are present. Those two totals are informational. A huge `cacheReadTokens` or `cached_tokens` value does not move the cap.

### OpenAI-format usage

Aliyun token-plan responses are OpenAI-compatible. When a logged `usage` object has `prompt_tokens` or `prompt_tokens_details`, uncached input is:

- `prompt_tokens - cached_tokens` when `prompt_tokens_details` is an object and `cached_tokens` is a non-negative integer (0 is a real zero).
- all of `prompt_tokens` when `prompt_tokens_details` is missing or null. That means the log has no cache info, so every prompt token is treated as uncached. This is the conservative direction.

`prompt_tokens` missing or not a non-negative integer is `MEASURE_FAIL`. It is never stored as 0. A non-numeric `cached_tokens` inside a present `prompt_tokens_details` object is also `MEASURE_FAIL`. If both `prompt_tokens` and pi-ai's `inputTokens` are present, `prompt_tokens` wins so a stale normalised field cannot hide the provider usage.

### pi-ai `inputTokens`

When the usage object has no `prompt_tokens` and no `prompt_tokens_details`, the meter reads pi-ai's normalised `inputTokens`. That number is already:

`prompt_tokens - cached_tokens - cache_write_tokens`

pi-ai treats a missing `cached_tokens` as 0 before that subtraction. The stored `inputTokens` then still includes tokens that were actually served from cache, so the uncached total is **over-counted**. Over-counting is the safe direction for this budget. A missing usage object, a missing `inputTokens`, or a non-numeric `inputTokens` is `MEASURE_FAIL`, not 0. A present `inputTokens: 0` is a real zero and counts as one call that added no uncached input.

This watchdog does not add a host-side counting proxy and does not re-query the provider. It only reads session logs and the headless `--json` transcript the run already wrote.

## Polling overshoot

The driver sees a call only after it has been written to a session log or the parent transcript. It then sleeps for `WD_POLL` seconds (default 2; an older driver used 20) and measures again. Between the call that crosses a limit and the SIGINT there is about one poll interval plus the time the measurement itself takes. Calls that finish in that window are already logged, so the run can stop a few calls past the cap. Requests that were in flight when the signal arrives are not logged, but the provider may already have accepted them.

Expect the completed-call overshoot to be on the order of one poll interval of calls (poll seconds times the recent call rate), plus the calls already in flight (`maxParallelStages`, 2 in the realistic mock). The mock scenarios `realistic_poll2` and `realistic_poll20` record the observed overshoot against that bound. Token overshoot is that many calls times the uncached input of each call. Shortening `WD_POLL` shrinks the window. It does not make the stop exact, and this tree does not add a proxy in front of the provider to make it exact.

## Aliyun token plan

Real-model calls use the Aliyun token plan. The endpoint and credential come only from the environment:

- `ALIYUN_TOKEN_PLAN_BASE_URL`
- `ALIYUN_TOKEN_PLAN_API_KEY`

`budget.sh provider` checks that both are set and non-blank. It prints that they are set. It does not print the values, and it does not print an `Authorization` header. If either variable is missing or blank, the command exits 2 and names the missing variable. Nothing is substituted: there is no Bailian or other fallback URL.

`drive.sh` runs that check before it starts the run. The offline mock sets `WD_OFFLINE=1` because it never calls a model. Do not set `WD_OFFLINE` for a real run; a missing variable must stop the run instead of sending it somewhere else.

## Ledger

State lives in `WD_STATE` (default `scripts/budget/state/`, gitignored). The ledger is `ledger.tsv`.

- `budget.sh init` creates the ledger. The header records the creation time and `start=0`, and the first row is a `start=0` entry of 0 tokens. The same line is appended to `ledger.log`. Running `init` again does not rewrite an existing ledger.
- A missing ledger, an empty ledger, or a ledger without the `start=0` header is `MEASURE_FAIL` when a run is measured or started. The tools do not recreate it and do not treat it as zero. Deleting the file does not reset the budget.
- `budget.sh reset --confirm` copies the current ledger to `ledger.tsv.archived-<timestamp>`, logs `RESET` with the previous uncached total, and writes a new `start=0` ledger. Without `--confirm` it refuses and changes nothing. If the file is already gone, reset refuses rather than creating a silent zero.
- Each finished run is one row keyed by its tag. `finish` replaces that tag's row. Running it twice, or crashing after the measurement and before the write, does not add the run twice. A later successful `finish` records the run once.
- Writes use a temp file, `fsync`, and an atomic rename, under `flock` on `ledger.lock`. Two concurrent finishes cannot drop each other's rows. The total survives process restart and `kill -9`: a kill mid-run leaves the previous rows on disk, and resuming the same tag keeps the original base so already logged calls stay in the count.

`WD_HOME`, `WD_PARENT_JSONL`, and `WD_STATE` select the DSH home, the headless transcript, and the ledger directory. There is no built-in home path.

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | OK | Under both limits. `drive.sh` also uses 0 when the run command itself exited 0 and no limit fired. |
| 2 | usage | Bad arguments, or the Aliyun token-plan variables are missing. `WD_RESET` on a tag that already has a ledger row is also exit 2. |
| 3 | refused | `drive.sh` did not start the run because another drive holds the lock, another tag has a base and no ledger row, or a recorded run process group is still alive. `budget.sh finish` and `budget.sh start` use the same code while that group is alive. |
| 4 | OVER_RUN | The per-run call limit fired (call 200 allowed; stop before 201). This includes a run that reaches the cap and exits before the next poll: the driver measures once more after the process exits. |
| 5 | OVER_TOTAL | Cumulative uncached input is past 10,000,000, including when that is first visible in the end-of-run measurement. |
| 6 | MEASURE_FAIL | The meter could not read usage, the ledger, or the base. The driver stops the run. A failed measurement is not a zero. A `usage.mjs` run that exceeds 60 seconds is this same failure, not a partial total. |

`drive.sh` logs a `WATCHDOG <VERDICT>` line that names the limit (`per-run-calls`, `cumulative-uncached-input`, or `measurement`) and includes the meter's call and token counts. The run command's own exit status is in that log as `run command exited <status>`. When the watchdog is what stopped the run, `drive.sh` exits 4, 5, or 6 rather than the signal status.

## Commands

```bash
export WD_STATE=scripts/budget/state
export ALIYUN_TOKEN_PLAN_BASE_URL=...
export ALIYUN_TOKEN_PLAN_API_KEY=...
./scripts/budget/budget.sh provider
./scripts/budget/budget.sh init
export WD_HOME=<dsh-home> WD_RUN_CMD=<run-executable>
# WD_RUN_CMD is one executable. drive.sh appends the tag as its only argument.
# The executable appends headless --json to WD_PARENT_JSONL (default: $WD_STATE/run-<tag>.jsonl).
./scripts/budget/drive.sh <tag>
./scripts/budget/budget.sh total
./scripts/budget/budget.sh reset --confirm
```

`budget.sh <tag>` prints one measurement line and then `OK`, `OVER_RUN`, `OVER_TOTAL`, or `MEASURE_FAIL`. `budget.sh finish <tag> [status]` records that tag. The same tag reuses its base, including after `kill -9`, so a resume keeps counting. A tag that already has a ledger row cannot be rebased: `WD_RESET=1` is refused and the recorded usage stays. Start a new tag instead.

An optional `$WD_STATE/<tag>.extra` file is a single non-negative integer. It adds that many calls and does not add uncached input.

The tools need Node >= 22.15. Set `WD_NODE` to that binary when `node` on `PATH` is older. An older binary is `MEASURE_FAIL`.

`drive.sh` records the run's pid, process group and `/proc/<pid>/stat` starttime (field 22). A pid is the recorded run only when that starttime still matches, so a reused pid is not treated as alive. While the process group is alive, every new start and every `finish` is refused. After the group exits, both are allowed. When the run process exits, `drive.sh` measures once more before it chooses exit 4, 5 or 6, so a cap crossed between polls is not reported as success. That measurement uses the attempt snapshot from `start`: an attempt that was not terminal then, or that appeared later, and is terminal now with no session log, is `MEASURE_FAIL` and is not stored as zero calls. Attempts that were already terminal in the snapshot are ignored when their logs are missing.

## Mock

```bash
npm run budget:mock
bash scripts/budget/mock/check.sh usage_parse provider_env
```

The harness uses a fake dsh. It does not need a provider key (`WD_OFFLINE=1`). Scenarios run one at a time so a loaded machine does not push `usage.mjs` into its 60 second timeout; that timeout still stops a real run with `MEASURE_FAIL`. The harness covers call 199, call 200, SIGINT before call 201 and a later resume, the 10,000,000 / 10,000,001 boundary, a missing ledger, `MEASURE_FAIL`, polling at 2s and 20s, `kill -9` then resume, a live process group after the driver is killed, duplicate and concurrent ledger writes, missing and non-numeric usage, a present zero, a settled tag refusing `WD_RESET`, terminal attempts with no session log, and corrupt ledger or base files. The 2s and 20s scenarios dominate the runtime and stay out of `npm test`.

`WD_LEDGER_PAUSE` and `WD_CRASH_BEFORE_LEDGER_WRITE` exist so the mock can hit the locked write. Leave them unset for a real run.
