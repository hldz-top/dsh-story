import { describe, expect, it } from 'vitest'
import { literalTextBlock, quotedText, readableList, readableText } from '../src/readable-markdown.ts'
import { links, nodes, parseLikeHost, rendered, visibleText } from './support/markdown.ts'

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
    expect(markdown).not.toMatch(/:\/\/|@|\bwww\./i)
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
      .toBe('- Artifact: artifact_1\n- Recorded URL: https&#58;//example.test/&#60;x&#62;\n- &#35; not a heading')
    expect(readableList(['first\nsecond'])).toBe('- first  \n  second')
  })
})

/** Web addresses whose characters were previously absorbed as character references into autolinks. */
const addresses = [
  'https://zh.wikipedia.org/wiki/灯塔_(建筑)?a=1&b=2#历史',
  'https://example.test/search?q=tide&lang=zh#top',
  'http://example.test/a_b/c_(d)',
  'www.example.test/path_(x)?k=v&m=n#frag',
]

describe('literalTextBlock', () => {
  it('fences machine output with a longer fence than any backtick run it contains', () => {
    expect(literalTextBlock('{"a":1}')).toBe('```text\n{"a":1}\n```')
    expect(literalTextBlock('x\n````\n# out')).toBe('`````text\nx\n````\n# out\n`````')
  })
})

describe('host preview grammar (GFM + math)', () => {
  it('keeps hostile text inside paragraphs, links only bare web addresses and preserves every visible character', () => {
    const tree = parseLikeHost(readableText(hostile.join('\n')))
    expect(new Set(nodes(tree).map(node => node.type))).toEqual(new Set(['root', 'paragraph', 'text', 'break', 'link']))
    expect(visibleText(tree)).toBe(hostile.join('\n'))
    expect(links(tree)).toEqual([{ url: 'https://tracker.test/p.png', text: 'https://tracker.test/p.png' }, { url: 'https://tracker.test', text: 'https://tracker.test' }])
    const quoted = parseLikeHost(quotedText(hostile.join('\n')))
    expect(new Set(nodes(quoted).map(node => node.type))).toEqual(new Set(['root', 'blockquote', 'paragraph', 'text', 'break', 'link']))
  })

  it.each(addresses)('links %s with its exact visible text and destination', address => {
    const tree = parseLikeHost(readableText(`来源 ${address} 结束`))
    expect(visibleText(tree)).toBe(`来源 ${address} 结束`)
    const href = address.startsWith('www.') ? `http://${address}` : address
    expect(links(tree)).toEqual([{ url: href, text: address }])
  })

  it('links addresses inside quotations and provenance lists exactly', () => {
    const [address] = addresses as [string]
    for (const markdown of [quotedText(`见 ${address}`), readableList([`Recorded URL: ${address}`, `Requested URL: ${address}`])]) {
      const tree = parseLikeHost(markdown)
      expect(links(tree).map(link => [link.url, link.text])).toEqual(links(tree).map(() => [address, address]))
      expect(links(tree).length).toBeGreaterThan(0)
      expect(JSON.stringify(tree)).not.toContain('&#')
    }
  })

  it('handles angle brackets around and inside an address without leaking references into the link', () => {
    const wrapped = parseLikeHost(readableText('<https://a.b>'))
    expect(visibleText(wrapped)).toBe('<https://a.b>')
    expect(links(wrapped)).toEqual([{ url: 'https://a.b', text: 'https://a.b' }])
    const inner = parseLikeHost(readableList(['Recorded URL: https://example.test/<x>']))
    expect(visibleText(inner)).toBe('Recorded URL: https://example.test/<x>')
    for (const link of links(inner)) {
      expect(link.url).toBe(link.text)
      expect(link.url).not.toContain('&#')
      expect('https://example.test/<x>'.startsWith(link.url)).toBe(true)
    }
  })

  it('links a www address directly after an underscore with its exact text and destination', () => {
    const text = 'a_www.evil.com/?a=1&b=2'
    const tree = parseLikeHost(readableText(text))
    expect(visibleText(tree)).toBe(text)
    expect(links(tree)).toEqual([{ url: 'http://www.evil.com/?a=1&b=2', text: 'www.evil.com/?a=1&b=2' }])
  })

  it('links e-mail addresses to their exact text', () => {
    expect(links(parseLikeHost(readableText('联系 keeper_1@example.test。')))).toEqual([{ url: 'mailto:keeper_1@example.test', text: 'keeper_1@example.test' }])
  })

  it('keeps machine output inside its code block even when it contains fences and Markdown', () => {
    const raw = '{"text":"```\\n# forged"}\n````\n# heading after fence\n[x](https://evil.test)'
    const tree = parseLikeHost(`## Complete response\n\n${literalTextBlock(raw)}\n\n## Provenance\n\n- Run: run_1\n`)
    const code = nodes(tree).filter(node => node.type === 'code')
    expect(code.map(node => node.value)).toEqual([raw])
    expect(nodes(tree).filter(node => node.type === 'heading').map(visibleText)).toEqual(['Complete response', 'Provenance'])
    expect(links(tree)).toEqual([])
  })
})
