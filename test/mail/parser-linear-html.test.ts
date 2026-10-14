// Regression tests (strix audit 2026-10-14): htmlToText and extractLinks must
// stay linear-time on unclosed-tag HTML — the lazy-regex predecessors froze
// the main process for 90 s (ingest) / 10 s (threat signals) on one mail.
import { describe, it, expect } from 'vitest'
import { htmlToText } from '@main/mail/parser'
import { extractLinks, computeMailSignals } from '@main/mail/threat-signals'

const ANCHOR = '<a href="https://e.co">'

describe('linear-time HTML parsing on unclosed tags', () => {
  it('htmlToText handles 100k unclosed <style> tags in ~10MB quickly', () => {
    const html = '<style>'.repeat(100_000) + 'x'.repeat(9 * 1024 * 1024)
    const t0 = process.hrtime.bigint()
    const text = htmlToText(html)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(text).toBe('')
    expect(ms).toBeLessThan(2_000) // quadratic predecessor: >160 s
  })

  it('extractLinks handles 17k unclosed anchors in 400KB quickly', () => {
    const n = Math.floor(400_000 / ANCHOR.length)
    const html = ANCHOR.repeat(n)
    const t0 = process.hrtime.bigint()
    const links = extractLinks(html)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(links.length).toBeLessThanOrEqual(300)
    expect(links[0].href).toBe('https://e.co')
    expect(ms).toBeLessThan(1_000) // quadratic predecessor: ~9.8 s
  })

  it('computeMailSignals stays fast on a poison phishing-style body', () => {
    const html = ANCHOR.repeat(5_000)
    const t0 = process.hrtime.bigint()
    computeMailSignals({
      fromName: 'Paypal Support',
      fromAddr: 'support@paypa1.example',
      replyToJson: null,
      subject: 'Verify your account',
      html,
      text: null
    })
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(ms).toBeLessThan(2_000) // quadratic predecessor: ~3.9 s
  })

  it('benign HTML still parses correctly', () => {
    expect(htmlToText('<style>a</style>1<p>Hallo <b>Welt</b></p>2')).toBe('1 Hallo Welt 2')
    expect(extractLinks('<a href="https://x.example"><b>bold</b> rest</a>')).toEqual([
      { text: 'bold rest', href: 'https://x.example' }
    ])
  })
})

describe('benign equivalence with the original lazy-regex behavior', () => {
  // Original implementations (pre-fix), verbatim
  function origHtmlToText(html: string): string {
    return html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#\d+;|&\w+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  function origExtractLinks(html: string): Array<{ text: string; href: string }> {
    const out: Array<{ text: string; href: string }> = []
    const re = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null && out.length < 300) {
      const href = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/&amp;/g, '&')
      const text = m[4]
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
      out.push({ text, href })
    }
    return out
  }

  const cases = [
    '<style>.a{color:red}</style><p>Text</p><script>alert(1)</script>',
    '<style>a</style>1<p>Hallo <b>Welt</b></p>2', // adjacent text without spaces
    '<html><head><title>T</title></head><body><p>A&amp;B</p>   <p>C&nbsp;D</p></body></html>',
    '<div>a</div><span>b</span>3',
    '<p>1</p><style>x</style><p>2</p><script>y</script>3'
  ]
  const linkCases = [
    '<a href="https://bank.example/login">https://secure-bank.example/login</a>',
    "<a href='https://x.example'>single quoted</a>",
    '<a href=https://y.example>unquoted</a>',
    '<a class="c" href="https://z.example?a=1&amp;b=2">multi <i>part</i> text</a>',
    '<a HREF="https://case.example">Case</a>',
    '<a href="https://n.example"><b>bold</b> rest</a>'
  ]

  it('htmlToText is byte-identical on benign inputs', () => {
    for (const c of cases) expect(htmlToText(c)).toBe(origHtmlToText(c))
  })
  it('extractLinks is identical on benign inputs', () => {
    expect(extractLinks(linkCases.join('\n'))).toEqual(origExtractLinks(linkCases.join('\n')))
  })
})
