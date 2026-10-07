import { describe, expect, it } from 'vitest'
import { suggestIsLocal } from '@main/ai/providers/host'

describe('suggestIsLocal (Vorschlag fürs lokal-Flag)', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://LOCALHOST/v1',
    'http://127.0.0.1:8080/v1',
    'http://127.5.6.7/v1',
    'http://[::1]:1234/v1',
    'http://mac-studio.local:8000/v1',
    'http://10.0.0.5/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.254/v1',
    'http://192.168.1.20:5000/v1'
  ])('%s ist lokal', (url) => {
    expect(suggestIsLocal(url)).toBe(true)
  })

  it.each([
    'https://openrouter.ai/api/v1',
    'https://api.openai.com/v1',
    'http://172.15.0.1/v1',
    'http://172.32.0.1/v1',
    'http://192.169.1.1/v1',
    'http://8.8.8.8/v1',
    'http://127.0.0.1.evil.example/v1',
    'http://localhost.evil.example/v1',
    'http://999.1.1.1/v1',
    'kein-url'
  ])('%s ist extern', (url) => {
    expect(suggestIsLocal(url)).toBe(false)
  })
})
