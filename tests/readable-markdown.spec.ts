import { describe, expect, it } from 'vitest'
import { quotedText, readableList, readableText } from '../src/readable-markdown.ts'

/** @param markdown - Generated Markdown. @returns Its visible text: character references and hard breaks decoded. */
function rendered(markdown: string): string {
  return markdown.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code))).replaceAll('  \n', '\n')
}

const hostile = [
  '# Forged heading', '[run](javascript:bad)', '![pixel](https://tracker.test/p.png)', '<script>bad()</script>', '`code` ```',
  '~~~', '- bullet', '+ bullet', '* bullet', '1. ordered', '2) ordered', '> quote', '---', '===', '| a | b |', '$x^2$',
  '\\(inline math\\)', '\\[display math\\]', '**bold** ~~struck~~', '[ref]: https://tracker.test', '[^1]', '&amp;',
  '夜色沉沉。林澜说：“走吧。”', 'END-BODY 3-5 a+b', 'snake_case artifact_00c3 __dunder__ _em_',
]

describe('readableText', () => {
  it('keeps every recorded word and line visible as plain paragraphs', () => {
    expect(rendered(readableText(hostile.join('\n')))).toBe(hostile.join('\n'))
    expect(readableText('第一段第一行\n第一段第二行\r\n\n\n第二段')).toBe('第一段第一行  \n第一段第二行\n\n第二段')
    expect(readableText('')).toBe('')
    expect(readableText(' \n\t\n')).toBe('')
  })

  it('leaves no character that can start Markdown, HTML, table or math syntax', () => {
    const markdown = readableText(hostile.join('\n'))
    expect(markdown.replace(/&#\d+;/g, '')).not.toMatch(/[\\`*~[\]<>&$|#]/)
    expect(markdown).not.toMatch(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/u)
    for (const line of markdown.split('\n')) expect(line).not.toMatch(/^(?:[-+=]|\d{1,9}[.)]|\s{4})/)
    expect(markdown).toContain('&#92;(inline math&#92;)')
    expect(markdown).toContain('1&#46; ordered\u0020\u0020\n2&#41; ordered')
  })

  it('keeps identifiers searchable and prose without syntax characters unchanged', () => {
    expect(readableText('artifact_00c38d7c-50d8 夜色沉沉。')).toBe('artifact_00c38d7c-50d8 夜色沉沉。')
    expect(readableText('Fog and a+b, 3-5')).toBe('Fog and a+b, 3-5')
  })

  it('keeps indentation visible without opening an indented code block and drops trailing breaks', () => {
    expect(readableText('    four spaces\n\tone tab\n　　全角缩进  ')).toBe('\u00a0'.repeat(4) + 'four spaces  \n' + '\u00a0'.repeat(4) + 'one tab  \n　　全角缩进')
  })
})

describe('quotedText', () => {
  it('quotes every line, including paragraph breaks, without escaping the quote', () => {
    expect(quotedText('潮🌊归航')).toBe('> 潮🌊归航')
    expect(quotedText('> nested\n\n# heading')).toBe('> &#62; nested\n>\n> &#35; heading')
    expect(rendered(quotedText(hostile.join('\n')))).toBe(hostile.map(line => `> ${line}`).join('\n'))
  })
})

describe('readableList', () => {
  it('renders one inert bullet per entry', () => {
    expect(readableList(['Artifact: artifact_1', 'Recorded URL: https://example.test/<x>', '# not a heading']))
      .toBe('- Artifact: artifact_1\n- Recorded URL: https://example.test/&#60;x&#62;\n- &#35; not a heading')
    expect(readableList(['first\nsecond'])).toBe('- first  \n  second')
  })
})
