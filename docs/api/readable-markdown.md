---
description: "Inert, readable Markdown for recorded prose, findings, quotations and provenance in document previews."
---
# Readable Markdown

## Summary

[The readable Markdown module](../../src/readable-markdown.ts) turns recorded text into Markdown that the Host document preview shows as ordinary text. [Artifact previews](../../src/artifact-markdown.ts) use it for chapter prose, outlines, settings content, review findings, research questions and conclusions, quotations and provenance. [Rejected-output previews](stage-deliveries.md) use it for the admission failure and provenance. Only the raw model response of a rejected output stays in a code block, because it is machine output (JSON).

## Functions

| Function | Output |
| --- | --- |
| `readableText(text)` | Paragraphs. A blank line separates paragraphs and a single line break becomes a Markdown hard break. Blank input returns an empty string. |
| `quotedText(text)` | The same content as a blockquote, used for cited evidence and source excerpts. |
| `readableList(items)` | One bullet per entry, used for provenance. |

## Inertness

Recorded text is data, not document structure. Every character that can start a Markdown, GFM, HTML or math construct is written as a numeric character reference such as `&#35;` for `#`. CommonMark always decodes these references to literal text. The encoded characters are `` \ ` * ~ [ ] < > & $ | # ``, an underscore at a word boundary, and a line-start `-`, `+`, `=` or ordered-list delimiter. Backslash escapes are not used. The Host preview grammar treats `\(` and `\[` as TeX math delimiters, so an escaped bracket would start math.

Leading spaces and tabs become no-break spaces, so indentation stays visible without starting an indented code block. Trailing spaces are dropped, so they cannot form a line break. An underscore between letters or digits cannot open or close emphasis and is kept, so identifiers such as `artifact_…` stay searchable in the raw file. A bare web address may still be autolinked by GFM as a visible copy of itself, which is how source URLs are already shown.

Settings and outline `contentMarkdown` is model-written Markdown. It is shown with its markers as literal text rather than rendered, so a forged heading or link cannot alter the preview document.

## Existing preview files

Preview files are immutable projections, and an existing file is verified byte for byte before it is presented again. Files written before readable rendering hold the previous fenced format. [`legacyArtifactMarkdown`](../../src/artifact-markdown.ts) reproduces that format exactly, and the [projection owner](../../src/projection.ts) accepts an existing file that equals either rendering. New files always receive the readable format. Any other content still fails as an edited preview. To show an older version in the readable format, delete its preview file; the next preview rebuilds it.
