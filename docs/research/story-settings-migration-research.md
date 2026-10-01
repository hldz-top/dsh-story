---
description: "Source-backed Story settings dimensions, dependencies and actual V2 behavior for the DSH TypeScript migration."
---
# Story settings migration evidence

## Summary

Story has 61 settings dimensions. The DSH catalog and planner preserve their names, original generation kinds, required markers and dependencies, expanding only the requested roots. This document distinguishes the former workshop rules from production V2 behavior. Catalog planning does not deliver generation, review or repair.

## Table of Contents

- [Sources and scope](#sources)
- [Behavior and migration decisions](#behavior)
- [Complete catalog](#catalog)
- [Implementation API](#api)
- [Dev Note](#dev-note)

<a id="sources"></a>
## Sources and scope

Evidence date: 2026-09-10. Paths below are relative to the Story root. SHA-256 identifies the exact file content inspected, including possible uncommitted changes; an earlier commit is not evidence of these files. Inspection used read-only source and AST parsing, with no Story imports, model requests, database connections or dependency installation. Story's CLAUDE.md was read; AGENTS.md and .codegraph were absent.

| Story source | Relevant lines | File SHA-256 |
| --- | --- | --- |
| `app/services/brainstorm/dimensions.py` | 42–78; 88–980 | `16ce597aa8bce3e3546b8d35fb392e8f9a567fb0dda397387b64822400226a6e` |
| `app/services/brainstorm/payload_schemas/__init__.py` | 104–124 | `6c88303ccf8db03c21b5de30b8454919a4d821482210b6ed57d04c59aa85f9bc` |
| `app/services/brainstorm/prompt_loader.py` | 67–184 | `1f8a0c8f0a099b3e86d165eb92ff34f3ceb657c9229bf1361bc80ea38fb6a641` |
| `app/services/brainstorm/enum_options.py` | 27–42; 4789–4836 | `84190d123cf53664ea0c610819695b197ce367d506aa1acbd73cfa203f3662d2` |
| `app/services/writing_pipeline/production_settings.py` | 222–235 | `69037b5f0a81bf0d45614620334402493a1a6ea38421bec0458c49727faeaa61` |
| `app/services/writing_pipeline/settings_tools.py` | 389–631; 1007–1116 | `cbad9b7d6dbdfab4a000a2db772017b577ee7d1867b435920df705ceafffb48c` |
| `app/services/writing_pipeline/settings_graph.py` | 825–953; 1440–1559; 1735–1940 | `26de94810b16f4e9c7618ba7246f32f13af8e0dbdee503b40b8438bff3ad11c2` |
| `app/services/writing_pipeline/body_tools.py` | 40–42; 507–512; 577–584 | `7d10ce91bd00f34f17b78eef9e90e4c724b0bb280ffb8d90f83eaa3a732de6c2` |
| `app/services/writing_pipeline/body_graph.py` | 1647–1662 | `ff66ce0459cb9b91c42a4c6b629c55ac2efd61260fce9b620b26b53dda212571` |

Dimension payloads live in `app/services/brainstorm/payload_schemas/category_{a..i}.py`. Templates live in `prompts/brainstorm/`: A1–A5 use `A1_genre.txt`, `A2_subgenre.txt`, `A3_audience.txt`, `A4_tone.txt` and `A5_spacetime.txt`; other templated dimensions use `<uppercase code>_<lowercase code>.txt`. E8 has no template. This document does not duplicate the entire legacy field inventory. Each later dimension migration must check its schema, prompt and actual consumers together.

<a id="behavior"></a>
## Behavior and migration decisions

| Aspect | Actual Story behavior | DSH decision |
| --- | --- | --- |
| Required dimensions | The former wizard requires a1/a2/a3/a4/a5/e1/g1/g2 for novels. V2 does not adapt required_for. | Preserve requiredFor as provenance; do not add these eight or all 61 automatically. |
| Dimension kinds | Original kinds are enum_single, enum_multi, llm_free and edit_external; V2 merges the first two as enum. | Preserve original kinds and reject external editor e8 from generation plans. |
| Root selection and DAG | The model selects a minimal sufficient root set with reasons; the service expands dependencies and orders layers. Independent dimensions can overlap. | A pure planner validates the catalog and selection and returns deterministic layers. DSH owns execution. |
| Fields and prompts | Workshop generation consumes per-dimension Pydantic schemas and TXT templates; V2 emits generic code/facts/content_md with four inline settings_graph.py roles. | Generic facts or a success flag do not prove detailed prompt migration. Migrate substantive requirements and structured output in later slices. |
| Research | V2 needs/dimension roles can research, persist references and read evidence. | Use DSH research records and actual reads. Required research failures stay failures; no-research is an explicit decision. |
| Review and repair | Review follows assembly; an open blocker prevents acceptance. Targeted patches trigger reassembly and review; no progress or exhausted limits stop. | Preserve the loop. The old review lacks separate evidence-range fields, so DSH must implement the specified exact-version locations and evidence. |
| Repair dependencies | Old patches retain dependency_refs and replace only dimensions named by issues. | Check affected dependencies after repairs. User edits to applied upstream content mark impact; downstream updating requires an explicit request. |
| Chapter length | body_tools/body_graph only warn outside 3000–5000. The dimension range of 500–2000 is also advisory despite stale prompt wording. | DSH checks assembled chapter length after each repair and enforces 3000–5000. This is not a settings-dimension length rule. |
| Runtime and storage | Python/LangGraph, serial execution within tool batches and database projection. | Use DSH model routing, AgentLoop, safe concurrency and storage.domain; no Python runtime dependency. |

Core-idea anchors, genre facts, character goals and initial state, relationships, ability costs and the main plot's four-part development can retain their business wording. Replace legacy candidate Markdown parsing, database input assembly, runtime/tool instructions and manual selection assumptions. Stylistic preferences must remain advisory even when an old prompt calls them mandatory. The old three-contract aggregator reads POV fields from A5 that its current schema does not contain; do not preserve that assumption.

The current modules implement catalog planning only. Model root selection, dimension generation, evidence-based review, repair, application and real-model quality still require implementation and validation under the [writing specification](../specs/story-writing-plugin/spec.md).

<a id="catalog"></a>
## Complete catalog

Codes use V2 lowercase spelling; the names below translate the original labels into English. In requiredFor, novel/script mean the workshop's novel_writing/script_writing markers, not compulsory DSH selection. Every source dimension is enabled. Some H dimensions concern short drama; V2 excludes them from novels only through prompt instructions. This inventory does not recommend them for every novel.

| code | English name | Direct dependencies | Original kind | requiredFor |
| --- | --- | --- | --- | --- |
| a1 | Genre / subject matter | — | enum_single | novel + script |
| a2 | Subgenre / narrative mode | a1 | enum_multi | novel + script |
| a3 | Target audience | a1 | enum_single | novel + script |
| a4 | Style and tone | a1,a3 | enum_multi | novel + script |
| a5 | Time and place | a1 | enum_single | novel + script |
| b1 | World structure / multiple realms | a1,a5 | llm_free | — |
| b2 | Geography / continents / cities | a5,b1 | llm_free | — |
| b3 | Historical background / chronology | a5 | llm_free | — |
| b4 | Political systems / dynasties / social classes | a1,a5 | llm_free | — |
| b5 | Economy / currency / commerce | a1,a5 | llm_free | — |
| b6 | Religion / belief / mythology | a1,a5 | llm_free | — |
| b7 | Races / nonhuman peoples / demon races | a1,b1 | llm_free | — |
| b8 | Climate / natural environment | a5,b2 | llm_free | — |
| b9 | Culture / customs / festivals | a5,b6 | llm_free | — |
| b10 | Languages / writing systems | a1,a5 | llm_free | — |
| b11 | Technology / industrial development | a5 | llm_free | — |
| b12 | Laws / statutes / religious precepts | b4 | llm_free | — |
| c1 | Cultivation ranks | a1,a2 | llm_free | — |
| c2 | Spiritual energy / energy sources | a1,c1 | llm_free | — |
| c3 | Special constitutions / bloodlines / spiritual roots | a1,c1 | llm_free | — |
| c4 | Cultivation methods / secret arts / inner disciplines | c1 | llm_free | — |
| c5 | Combat moves / skills / divine abilities | c2,c4 | llm_free | — |
| c6 | Magical artifacts / divine artifacts / treasures | c1 | llm_free | — |
| c7 | Elixirs / spiritual medicines / immortal medicines | c2 | llm_free | — |
| c8 | Magical formations / talismans / wards | c1,c2 | llm_free | — |
| d1 | Factions / organizations | a1,b1 | llm_free | — |
| e1 | Protagonist profile | a1,a2 | llm_free | novel + script |
| e2 | Male lead / female lead / dual protagonists | e1 | llm_free | — |
| e3 | Antagonists by tier | e1 | llm_free | — |
| e4 | Arc antagonists / lifelong nemesis | e1,e3 | llm_free | — |
| e5 | Supporting allies | e1 | llm_free | — |
| e6 | Supporting cast | e1,e5 | llm_free | — |
| e7 | Demonic beasts / spirit companions / divine beasts | a1,b7 | llm_free | — |
| e8 | Relationship network (character graph) | e1 | edit_external | — |
| e9 | Dialogue style | e1,e2,e3 | llm_free | — |
| e10 | Inner monologue / subtext style | e1,e2 | llm_free | — |
| f1 | Character names | a1,a5 | llm_free | — |
| f2 | Weapon names | a1,c6 | llm_free | — |
| f3 | Combat move names | a1,c5 | llm_free | — |
| f4 | Artifact names | a1,c6 | llm_free | — |
| f5 | Sect / organization names | a1,d1 | llm_free | — |
| f6 | Place / country names | a1,a5,b2 | llm_free | — |
| g1 | Protagonist's exceptional advantage | a1,a2 | llm_free | novel + script |
| g2 | Main plot | a1,g1,e1 | llm_free | novel + script |
| g3 | Arc objectives / progression | g2 | llm_free | — |
| g4 | Reader gratification / payoff design | a3,g2 | llm_free | — |
| g5 | Angst / misunderstandings / contrasts | a4,e2 | llm_free | — |
| g6 | Reversals / turning points | g2 | llm_free | — |
| g7 | Foreshadowing / hooks | g2 | llm_free | — |
| g8 | Plot devices and trope library | a1,a2 | llm_free | — |
| h1 | Opening hook (strong conflict within 30 seconds) | a1,a4 | enum_multi | — |
| h2 | Beat timing | h1 | llm_free | — |
| h3 | Episode-ending hook | a4 | enum_multi | — |
| h4 | Episode pacing curve | a4 | enum_single | script_writing |
| h5 | Tropes for male / female audiences | a3 | enum_single | script_writing |
| h6 | Props / symbolic turning points | e1,g2 | llm_free | — |
| i1 | Scene description | a4 | llm_free | — |
| i2 | Combat description | c5,e3 | llm_free | — |
| i3 | Emotional description | a4,e1 | llm_free | — |
| i4 | Dialogue generation / polishing | a4,e9 | llm_free | — |
| i5 | Inner thoughts / narration | e10 | llm_free | — |

<a id="api"></a>
## Implementation API

[`settingsCatalog`](../../src/settings-catalog.ts) is independent TypeScript data with no Story runtime dependency. Entries contain code, name, dependsOn, enabled, kind and requiredFor. `planSettings(roots, catalog = settingsCatalog)` returns selectedCodes sorted by code and layers ordered by dependency; each layer is sorted by code and contains no dependency pair. Empty or duplicate roots, unknown roots, duplicate catalog codes, missing dependencies, cycles and selected disabled/external dimensions throw errors. The planner does not substitute a default generation plan.

[`summarizeSettingsCatalog`](../../src/settings-plan.ts) supplies each selectable root's dependencies and closure size for later needs analysis; it performs no model or storage work. An invalid catalog also fails summary construction rather than silently hiding problematic entries. Public behavior is covered by [`settings-plan.spec.ts`](../../tests/settings-plan.spec.ts).

<a id="dev-note"></a>
## Dev Note

The catalog preserves workshop requiredFor and kind values so historical UI rules are not presented as V2 mechanical checks. The pure planner introduces no service, tool or model configuration; writing stages own later public integration.
