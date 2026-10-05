import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Dev-only (NOCTUA_TEST_SHOTS=demo, siehe scripts/demo-tour.sh): Screenshot-Tour
 * über die Demo-Daten (dev/demo-seed.ts). Bedient die UI per Menü-Aktionen,
 * Tasten (sendInputEvent) und DOM-Klicks im Renderer; jeder Schritt läuft
 * einzeln in try/catch, damit ein verändertes Label nicht die ganze Tour kippt.
 * Durchläufe (NOCTUA_DEMO_PASS): main = Hauptansichten, small = 1180px-Breite.
 */
export function runDemoTour(win: () => BrowserWindow | null, push: PushFn): void {
  const outDir = process.env.NOCTUA_SHOT_DIR || join(app.getPath('temp'), 'noctua-demo-shots')
  mkdirSync(outDir, { recursive: true })
  const pass = process.env.NOCTUA_DEMO_PASS || 'main'

  const js = async <T = unknown>(code: string): Promise<T | null> => {
    const w = win()
    if (!w) return null
    return (await w.webContents.executeJavaScript(code)) as T
  }

  const key = (keyCode: string, modifiers: Array<'meta' | 'shift' | 'control'> = []): void => {
    const w = win()
    if (!w) return
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }

  const typeText = (text: string): void => {
    const w = win()
    if (!w) return
    for (const ch of text) {
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch })
      w.webContents.sendInputEvent({ type: 'char', keyCode: ch })
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch })
    }
  }

  const clickAt = (x: number, y: number): void => {
    const w = win()
    if (!w) return
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  /** Klickt (echte Mausereignisse) die Mitte des ersten Elements, dessen Text passt. */
  const clickText = async (
    selector: string,
    text: string,
    nth = 0,
    exact = false
  ): Promise<boolean> => {
    const rect = await js<{ x: number; y: number } | null>(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => {
          const wants = ${JSON.stringify(text.toLowerCase().split('|'))}
          const hit = (v) => wants.some((want) => ${exact ? '(v || "").trim().toLowerCase() === want' : '(v || "").trim().toLowerCase().includes(want)'})
          return hit(e.textContent) || hit(e.getAttribute('aria-label')) || hit(e.getAttribute('title'))
        })
      const el = els[${nth}]
      if (!el) return null
      el.scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (!rect) {
      console.warn(`[tour] nicht gefunden: ${selector} "${text}"`)
      return false
    }
    clickAt(rect.x, rect.y)
    return true
  }

  const shot = async (name: string): Promise<void> => {
    const w = win()
    if (!w) return
    const image = await w.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    console.log(`[shots] ${name}.png`)
  }

  const resize = async (width: number, height: number): Promise<void> => {
    const w = win()
    if (!w) return
    w.setContentSize(width, height)
    await wait(700)
  }

  const go = (action: PushPayload<'app:menuAction'>['action']): void =>
    push('app:menuAction', { action })

  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (error) {
      console.error(`[tour] Schritt "${name}" fehlgeschlagen:`, error)
    }
  }

  const dump = async (label: string): Promise<void> => {
    const text = await js<string>('document.body.innerText.slice(0, 1500)')
    console.log(`[dump:${label}] ${JSON.stringify(text)}`)
  }

  /** Scrollt die breiteste scrollbare Fläche der Mitte (Sheet) auf y. */
  const scrollMain = async (y: number, fromEnd = false): Promise<void> => {
    await js(`(() => {
      const els = [...document.querySelectorAll('*')].filter((e) => {
        const s = getComputedStyle(e)
        const r = e.getBoundingClientRect()
        return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20 && r.left > 380 && r.width > 450
      })
      els.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)
      if (els[0]) els[0].scrollTop = ${fromEnd} ? els[0].scrollHeight - els[0].clientHeight - ${y} : ${y}
    })()`)
    await wait(400)
  }

  /** Klick auf einen Link im Mail-iframe (Koordinaten des iframes + des Ankers). */
  const clickMailLink = async (textPart: string): Promise<boolean> => {
    const pos = await js<{ x: number; y: number } | null>(`(() => {
      const f = document.querySelector('iframe.mail-html')
      if (!f || !f.contentDocument) return null
      const a = [...f.contentDocument.querySelectorAll('a')].find((x) => (x.textContent || '').includes(${JSON.stringify(textPart)}))
      if (!a) return null
      a.scrollIntoView({ block: 'center' })
      const fr = f.getBoundingClientRect()
      const r = a.getBoundingClientRect()
      return { x: Math.round(fr.left + r.left + Math.min(20, r.width / 2)), y: Math.round(fr.top + r.top + r.height / 2) }
    })()`)
    if (!pos) return false
    clickAt(pos.x, pos.y)
    return true
  }

  const openRow = async (text: string): Promise<void> => {
    await clickText('[data-selected]', text)
    await wait(1200)
  }

  /** Klick in eine Tagesspalte des Kalenders (dayIndex ab sichtbarem Anfang, Stunde als Dezimalzahl). */
  const clickSlot = async (dayIndex: number, hour: number): Promise<void> => {
    const pos = await js<{ x: number; y: number } | null>(`(() => {
      const sc = document.querySelector('.cal-scroll')
      const cols = [...document.querySelectorAll('.cal-col')]
      const col = cols[${dayIndex}]
      if (!sc || !col) return null
      const hourH = col.getBoundingClientRect().height / 24
      sc.scrollTop = Math.max(0, (${hour} - 3) * hourH)
      const r = col.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + ${hour} * hourH) }
    })()`)
    if (!pos) return
    await wait(300)
    const fresh = await js<{ x: number; y: number }>(`(() => {
      const col = document.querySelectorAll('.cal-col')[${dayIndex}]
      const r = col.getBoundingClientRect()
      const hourH = r.height / 24
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + ${hour} * hourH) }
    })()`)
    if (fresh) clickAt(fresh.x, fresh.y)
  }

  const openSettings = async (label: string): Promise<void> => {
    go('settings')
    await wait(900)
    await clickText('[data-selected]', label)
    await wait(1200)
  }

  // Ab hier: die eigentlichen Durchläufe
  const main = async (): Promise<void> => {
    await resize(1440, 900)
    await step('inbox', async () => {
      go('inbox')
      await wait(1500)
      await shot('01-inbox-newsletter')
      await scrollMain(700)
      await shot('01b-inbox-newsletter-scrolled')
      await scrollMain(0)
    })
    await step('invitation', async () => {
      await openRow('Marta')
      await shot('02-invitation')
    })
    await step('mismatch', async () => {
      await openRow('Sparkasse')
      await shot('03-link-mismatch')
      if (await clickMailLink('sparkasse.de')) {
        await wait(700)
        await shot('03b-link-mismatch-warning')
        await clickText('button', 'dismiss|schließen', 0, true)
        await wait(500)
      }
    })
    await step('remote-image', async () => {
      await openRow('ParcelHub')
      await shot('04-remote-images-blocked')
      await clickText('.anim-rise button', 'show|anzeigen', 0, true)
      await wait(1500)
      await shot('04b-remote-images-shown')
    })
    await step('attachment', async () => {
      await openRow('Jonas Weber')
      await shot('05-mail-attachment-task')
    })

    await step('calendar-week', async () => {
      go('calendar')
      await wait(1800)
      await shot('10-calendar-week')
      key('d')
      await wait(900)
      await shot('11-calendar-day')
      key('m')
      await wait(900)
      await shot('12-calendar-month')
      key('w')
      await wait(700)
    })
    await step('quick-create', async () => {
      await clickSlot(4, 16)
      await wait(700)
      await shot('13-quick-create')
      key('Escape')
      await wait(400)
    })
    await step('editor-attendees', async () => {
      await clickText('.cal-event', 'Quarterly planning')
      await wait(1200)
      await shot('14-event-editor-attendees')
      await js(
        `(() => { const e = document.querySelector('.cal-editor .overflow-y-auto'); if (e) e.scrollTop = 9999 })()`
      )
      await wait(900)
      await shot('14b-event-editor-attendees-list')
      // Autocomplete: Adressbuch/Mail-Historie
      await js(`(() => {
        const i = document.querySelector('.cal-editor input[aria-label*="ttendee" i], .cal-editor input[aria-label*="eilnehmer" i]')
        if (i) i.focus()
      })()`)
      typeText('ma')
      await wait(900)
      await shot('14c-event-editor-attendee-autocomplete')
      // Fokus weg (unvollständige Eingabe wird verworfen), nicht Escape: das würde den Editor schließen
      await js(`(() => { if (document.activeElement) document.activeElement.blur() })()`)
      await wait(300)
      await clickText('.cal-editor button.text-btn', 'next free slot|nächster gemeinsamer')
      await wait(1500)
      await js(
        `(() => { const e = document.querySelector('.cal-editor .overflow-y-auto'); if (e) e.scrollTop = 9999 })()`
      )
      await wait(400)
      await shot('14d-event-editor-next-free-slot')
      key('Escape')
      await wait(500)
    })
    await step('editor-recurring-scope', async () => {
      await clickText('.cal-event', 'Team sync')
      await wait(1200)
      await shot('15-event-editor-recurring')
      await js(`(() => {
        const i = document.querySelector('.cal-summary-input')
        if (i) { i.focus(); i.select() }
      })()`)
      typeText('Team sync (new time)')
      await wait(300)
      await clickText('button.ink-btn', 'save|speichern')
      await wait(900)
      await shot('16-scope-choice')
      key('Escape')
      await wait(400)
      key('Escape')
      await wait(400)
    })
    await step('palette', async () => {
      await clickText('button', 'colour of work|farbe von work')
      await wait(500)
      await shot('17-calendar-colour-palette')
      key('Escape')
    })

    await step('tasks', async () => {
      go('tasks')
      await wait(1500)
      await shot('20-tasks')
    })

    await step('settings-accounts', async () => {
      await openSettings('accounts|konten')
      await shot('30-settings-accounts')
      await scrollMain(0, true)
      await shot('30b-settings-accounts-end')
    })
    await step('settings-intel', async () => {
      await openSettings('intelligence|intelligenz')
      await shot('31-settings-intelligence')
      await scrollMain(650)
      await shot('31b-settings-intelligence-models')
      await scrollMain(0, true)
      await shot('31c-settings-intelligence-end')
    })
    await step('settings-tech', async () => {
      await openSettings('under the hood|technik')
      await shot('32-settings-tech')
      await scrollMain(0, true)
      await shot('32b-settings-tech-network')
      await scrollMain(700, true)
      await shot('32c-settings-tech-diagram')
    })
    if (process.env.NOCTUA_TOUR_DUMP) await dump('end')
  }

  const small = async (): Promise<void> => {
    await resize(1180, 760)
    await step('inbox', async () => {
      go('inbox')
      await wait(1200)
      await shot('40-inbox-1180')
    })
    await step('calendar', async () => {
      go('calendar')
      await wait(1500)
      await shot('41-calendar-week-1180')
      key('m')
      await wait(800)
      await shot('42-calendar-month-1180')
      key('d')
      await wait(800)
      await shot('43-calendar-day-1180')
      key('w')
      await wait(500)
      await clickText('.cal-event', 'Quarterly planning')
      await wait(1200)
      await shot('44-event-editor-1180')
      await js(
        `(() => { const e = document.querySelector('.cal-editor .overflow-y-auto'); if (e) e.scrollTop = 9999 })()`
      )
      await wait(900)
      await shot('44b-event-editor-attendees-1180')
      key('Escape')
    })
    await step('settings', async () => {
      await openSettings('accounts|konten')
      await shot('45-settings-accounts-1180')
    })
  }

  /** Onboarding mit Org-Profilen (Build mit NOCTUA_ORG_CONFIG, siehe scripts/demo-tour.sh). */
  const onboarding = async (): Promise<void> => {
    await resize(1440, 900)
    await step('onboarding', async () => {
      await wait(1500)
      await shot('60-onboarding-connect')
      await clickText('button', 'continue|weiter')
      await wait(1200)
      await shot('61-onboarding-org-profiles')
    })
  }

  const local = async (): Promise<void> => {
    await resize(1440, 900)
    await step('inbox', async () => {
      go('inbox')
      await wait(1500)
      await shot('50-local-only-inbox')
    })
    await step('intel', async () => {
      await openSettings('intelligence|intelligenz')
      await shot('51-local-only-intelligence')
      await scrollMain(0, true)
      await shot('51b-local-only-intelligence-end')
    })
    await step('tech', async () => {
      await openSettings('under the hood|technik')
      await scrollMain(0, true)
      await shot('52-local-only-tech-network')
    })
  }

  setTimeout(() => {
    void (async () => {
      try {
        if (pass === 'small') await small()
        else if (pass === 'local') await local()
        else if (pass === 'onboarding') await onboarding()
        else await main()
        console.log('[shots] fertig:', outDir)
      } catch (error) {
        console.error('[shots] Tour fehlgeschlagen:', error)
      }
      if (process.env.NOCTUA_TOUR_EXIT !== '0') app.quit()
    })()
  }, 5000)
}
