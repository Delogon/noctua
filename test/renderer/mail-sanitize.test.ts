import { describe, expect, it } from 'vitest'
import {
  buildMailSrcdoc,
  isTrackingPixel,
  mailFrameCsp,
  sanitizeInlineStyle
} from '@renderer/lib/mail-sanitize'
import { linkHostMismatch } from '@shared/link-check'

describe('sanitizeInlineStyle', () => {
  it('behält harmlose Deklarationen', () => {
    expect(sanitizeInlineStyle('color: red; font-size: 12px')).toBe('color: red; font-size: 12px')
  })

  it('entfernt url(), image-set(), @import, expression()', () => {
    expect(sanitizeInlineStyle('color:red; background:url(https://t.example/x.gif)')).toBe(
      'color:red'
    )
    expect(sanitizeInlineStyle('background-image: URL( "https://t" )')).toBe('')
    expect(sanitizeInlineStyle('background: image-set("a.png" 1x)')).toBe('')
    expect(sanitizeInlineStyle('width: expression(alert(1)); color: blue')).toBe('color: blue')
    expect(sanitizeInlineStyle('@import "x"; color: blue')).toBe('color: blue')
  })

  it('entfernt position fixed/sticky, nicht absolute/relative', () => {
    expect(sanitizeInlineStyle('position: fixed; top:0')).toBe('top:0')
    expect(sanitizeInlineStyle('POSITION:Sticky')).toBe('')
    expect(sanitizeInlineStyle('position: relative')).toBe('position: relative')
  })

  it('erkennt Umgehungen über Kommentare, Escapes und ; in url()', () => {
    expect(sanitizeInlineStyle('background: ur/**/l(x)')).toBe('')
    expect(sanitizeInlineStyle('background: u\\72l(https://t)')).toBe('')
    expect(sanitizeInlineStyle('background: url("a;b"); color: red')).toBe('color: red')
  })
})

describe('isTrackingPixel', () => {
  it('erkennt 1x1 und winzige Bilder', () => {
    expect(isTrackingPixel({ width: '1', height: '1' })).toBe(true)
    expect(isTrackingPixel({ width: '2px' })).toBe(true)
    expect(isTrackingPixel({ height: '0' })).toBe(true)
    expect(isTrackingPixel({ style: 'width:1px;height:1px' })).toBe(true)
  })

  it('erkennt versteckte Bilder', () => {
    expect(isTrackingPixel({ style: 'display:none' })).toBe(true)
    expect(isTrackingPixel({ style: 'visibility: hidden' })).toBe(true)
  })

  it('lässt normale Bilder und Prozentwerte durch', () => {
    expect(isTrackingPixel({ width: '600', height: '200' })).toBe(false)
    expect(isTrackingPixel({ width: '100%' })).toBe(false)
    expect(isTrackingPixel({})).toBe(false)
    expect(isTrackingPixel({ style: 'display:block;width:300px' })).toBe(false)
  })
})

describe('mail frame srcdoc', () => {
  it('erlaubt https-Bilder nur nach Freigabe', () => {
    expect(mailFrameCsp(false)).toBe(
      "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"
    )
    expect(mailFrameCsp(true)).toContain('img-src data: cid: https:')
    expect(buildMailSrcdoc('<p>hi</p>', false)).toContain('Content-Security-Policy')
    expect(buildMailSrcdoc('<p>hi</p>', false)).toContain('<body><p>hi</p></body>')
  })
})

describe('linkHostMismatch', () => {
  it('meldet abweichenden Host bei URL-artigem Text', () => {
    expect(linkHostMismatch('https://paypal.com/login', 'https://evil.example/x')).toEqual({
      shown: 'paypal.com',
      actual: 'evil.example'
    })
    expect(linkHostMismatch('paypal.com', 'https://paypal.com.evil.example/')).not.toBeNull()
  })

  it('ignoriert gleiche Hosts, www und Subdomains', () => {
    expect(linkHostMismatch('www.example.com', 'https://example.com/a')).toBeNull()
    expect(linkHostMismatch('example.com', 'https://click.example.com/r?x=1')).toBeNull()
    expect(linkHostMismatch('https://Example.com', 'https://example.com')).toBeNull()
  })

  it('ignoriert normalen Text und Nicht-http-Links', () => {
    expect(linkHostMismatch('Hier klicken', 'https://evil.example')).toBeNull()
    expect(linkHostMismatch('Visit example.com today', 'https://evil.example')).toBeNull()
    expect(linkHostMismatch('example.com', 'mailto:a@evil.example')).toBeNull()
  })
})
