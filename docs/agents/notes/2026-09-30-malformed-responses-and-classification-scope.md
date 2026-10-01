# Agent Note: Malformed stage responses and classification-dimension scope

Status: implemented with deterministic offline tests. The built-profile rehearsal and the second real-model run are recorded separately when they complete.

## Problem

The first real-model runs on DSH `0.2.0-rc.2` (2026-09-30 and 2026-10-01, `deepseek-account` route, `deepseek-flash` model) ended before any chapter was applied. They exposed five plugin defects.

1. A settings review child streamed a `structured_output` call with invalid JSON arguments. DSH's DeepSeek adapter ended the child turn with the error code `MALFORMED_RESPONSE`, so the stage had no structured result. The runner classified the attempt as outcome unknown and failed the run. The model call had in fact completed, and its only defect was unusable output. The author still had to authorize a resume.
2. After the resume, the settings collection review blocked on an internal contradiction in `a5` (时空设定). The catalog declares that dimension as `enum_single`, which expects a classification. The model wrote a detailed world bible instead, with invented dates, distances and other precise facts. Each repair introduced new contradictions until `maxRepairAttempts` was exhausted. The stage prompts and reviews never used the catalog `kind`, so nothing limited a classification dimension's scope. Every stage prompt, including settings stages, also stated the chapter-total range of 3000–5000 Story-counted words. Under the Chinese counting rule each CJK character counts as one word. The applied classification dimensions `a1`–`a4` landed at 3.3k–3.8k characters, inside that range, which suggests the models treated the range as a size target.
3. In the second run, the `a3` (受众) research planner froze a question asking for the enum option set that the program provides at runtime. The catalog records each dimension's `kind` but no option lists; the original Story option lists were not migrated. The research child read every input, reported the question as inadequately answered, and admission correctly failed the run. Resuming would reuse the saved research result and fail the same way.
4. In the third run, the `e1` research answered both of its external questions with findings that cite only successful web calls. Two other fetches that no finding cited had failed: one unsupported PDF, one transport error. The aggregate rule marked the whole plan failed whenever any observation failed, so admission rejected adequately supported research.
5. A continuation on the same novel reached the first chapter body. The outlines planned 3,300 words, but the first body counted 9,843 Story words and the two length repairs reached 5,277 and then about 5,100, above the 5,000 maximum. The body prompt stated only the range. The length repair message gave only the count and status, while the generic repair line asked the model to preserve unaffected passages.

## Decision

**A malformed response retries the identical stage request.** When a native child ends with `MALFORMED_RESPONSE` and no structured result, the [stage executor](../../api/stage-execution.md) raises `stage-malformed`. The [writing runner](../../api/writing-runner.md) records that attempt as `failed`: a response arrived and could not be used, so the outcome is known. The runner then prepares a replacement attempt with the same stage key and a byte-identical request, up to `maxRepairAttempts` replacements for that stage. Each replacement is a durable attempt counted by `maxRunAttempts`. When the replacements are exhausted, the run fails with the malformed-response message, and an explicit resume replaces the failed attempt with the same request. Other turn failures, timeouts and interruptions keep their existing classification. A structured value captured before a later turn error is not treated as malformed; that case keeps its previous outcome-unknown classification.

**A classification dimension stays a classification.** Settings generation and review prompts use the catalog kind. For `enum_single` and `enum_multi` dimensions, a candidate states the selected label or labels, brief grounds and only the constraints that later stages must honor. It does not invent concrete specifics, such as dates, distances, measurements, schedules, or named organizations or equipment, unless the brief or accepted research states them. Detailed world facts belong to world-building dimensions. When a new classification candidate is admitted, more than 10 facts or more than 2,500 code points of `contentMarkdown` raise a `StageOutputError`, which enters the existing bounded repair loop. `llm_free` dimensions keep the world-building guidance. Classification prompts keep the rules shared by every settings dimension, such as preserving the creative premise and author constraints and never changing accepted upstream settings. They omit the world-building guidance. Every settings prompt cites research only by question IDs present in that stage's accepted evidence. The chapter-total range is stated only to stages that write or review a book outline, chapter outline or body.

**The catalog defines no option lists.** Research planning, research and classification-settings prompts state that a catalog entry is the complete dimension definition, that its kind describes only the output form, and that no predefined option list exists: choosing a label is a creative decision grounded in the brief and accepted dependencies. Research planning must not ask about host program internals, such as option lists, schemas, validation rules, counting implementation or tools, and every internal question must be answerable from the supplied inputs. A research child resolves any remaining question about available options from the task data as a creative choice instead of reporting missing evidence.

**The research outcome follows the findings.** A finding that cites a failed call remains failed, and a failed finding still fails the plan. A failed call that no finding cites stays recorded in the evidence with its status and error, but it no longer fails the plan by itself. The legacy version-1/2 classifier is unchanged.

**Length guidance is quantitative.** Stages that plan, write or review outlines and bodies receive the range and the Story counting rule: each Chinese character counts as one word, each ASCII word or number counts as one word, and punctuation and whitespace count as zero. Only the body writing stage also receives an aim at the middle of the range, so that outline plans and reviews are not given a second target; review prompts state that a host-measured count inside the range is not a length defect. A length repair states the host count, the range, the distance from the violated bound, the per-scene counts and the aim, and asks for condensing or expanding across all scenes while preserving required events, facts and scene identities rather than passage wording. The program-owned counter and bounds are unchanged.

The size bound applies only when a new model output is admitted. Readback validation of stored candidates and replay of an already admitted request remain structural checks. Candidates created before this change therefore stay readable and usable as inputs. When a run started before this change reaches a stage whose prompt changed and that already has a stored attempt, the run store rejects the changed request with `attempt-conflict` before calling the model. On the way there, a resume can still re-run earlier unchanged stages whose latest attempts are unknown or failed.

## Consequences

- A completed run still requires saved successful output for every latest stage attempt. A malformed-response retry reuses its stage key, so a resumed run replays the same path and reuses saved output instead of re-executing the malformed stage.
- Each retry starts a new native child, which repeats the stage's reads and model requests. A research-stage retry also repeats its web calls and creates a new research plan; the abandoned plan stays in history. One stage can execute up to 1 + `maxRepairAttempts` times, and each explicit resume after exhaustion allows up to 1 + `maxRepairAttempts` more executions within `maxRunAttempts`. Setting `maxRepairAttempts: 0` disables the retry.
- A research admission failure stays terminal: resume replays the saved research output, and the research-planning decision sits outside any repair loop. The planning prompt is the only mitigation for an unanswerable planned question. A bounded re-plan under a successor key would need its own design.
- DSH's default model retry policy does not retry `MALFORMED_RESPONSE`; its default retryable codes are `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT` and `TRANSPORT`. Under that policy, plugin retries do not multiply with host retries inside a child.
- Calibration from the failed run: the applied classification dimensions `a1`–`a4` had 12–16 facts and 3.3k–3.8k characters. Every `a5` candidate had 14–19 facts and 3.5k–6k characters. The kind-aware prompts ask for much less and no longer state a chapter length to settings stages. A candidate that still exceeds the bound receives the exact counts in its repair error.

## Alternatives considered

**Keep the outcome unknown and require an author decision.** Chapter bodies are emitted as long JSON arguments, so a random syntax error can recur at any stage of a three-chapter run. An author decision about a known invalid response adds no safety, because the replacement request is identical and bounded.

**Send a malformed response through the invalid-output repair loop.** This was implemented first and rejected before release. The loop advances to a new stage key that carries a validation error, which leaves the malformed key's latest attempt failed. A later resume replays that key with a new paid request, diverges from the stored path and can end in an attempt conflict. The approach also required relaxing the run store's completion invariant.

**Retry inside the stage executor without durable attempts.** Hidden retries would bypass attempt accounting and the durable record of provider requests.

**Parse the malformed arguments leniently.** The plugin never receives the invalid arguments, and guessing the intended JSON would admit output the model did not produce. Tolerant decoding would be a separately scoped DSH change.

**Raise `maxRepairAttempts`, or leave `a5` out of the requested roots.** More attempts did not converge, because each regeneration added new fixed facts to contradict. Leaving the dimension out avoids the defect for one run but not for any author who selects it.

**Check cited research IDs against a pattern.** Question IDs are free-form, for example `a1-genre-anchor`, `a3-q1-primary-audience` and `a5-q10`, and fact IDs look similar, for example `a5-f12`. The apparently invented `a5-q6`–`a5-q11` citations were stale IDs from the dimension's first research plan. A pattern check would reject valid output and miss real mistakes, so the prompts restrict citations to the stage's own evidence instead.

**Keep the chapter-range line in every prompt and add "applies to chapters only".** A size figure has no use in a settings or continuity stage; leaving it out removes the ambiguity instead of qualifying it.

**Migrate Story's option lists into the catalog now.** Story defines options in `app/services/brainstorm/enum_options.py`. Carrying them changes the catalog contract, how prompts present choices, possibly admission validation, and compatibility with stored candidates. That needs its own scoped design and remains a follow-up; the prompt statement removes the immediate ambiguity.

**Accept an inadequate internal finding when research needed no retrieval.** Every planned question must be answered adequately before settings depend on it. Relaxing that would let unresolved questions pass silently.

**Keep failing research on any failed call.** Open-web retrieval routinely meets unsupported formats and unreachable hosts. A failed fetch contributes no content that a finding could rely on or hide, so failing the plan on it rejects adequately supported research without protecting any conclusion.

**Retry failed fetches automatically.** A retry changes nothing for an unsupported format and adds web calls within a finite budget; the research child already chooses other sources.

**Raise `maxRepairAttempts` for length.** More attempts with the same vague message converge slowly and multiply full-chapter generations; a quantitative message addresses the cause.

**Enforce a per-scene ceiling.** The specification forbids replacing the chapter-total rule with a scene ceiling. Per-scene counts in the repair message are guidance only.

**Make the reviewer more lenient.** Real contradictions must still block. The kind-aware review only stops requiring world detail or plot elements that other dimensions or chapters own.

## Verification and remaining scope

Pending: the executed test names and results, the rebuilt artifact hashes, the built-profile rehearsal and the second real-model run.
