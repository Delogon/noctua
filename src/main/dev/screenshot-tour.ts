import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Dev-only (NOCTUA_TEST_SHOTS=1): goes through all views and saves PNGs to
 * NOCTUA_SHOT_DIR — self-review of the UI without screen access. Views
 * switch via app:menuAction, keys (Enter/Escape/⌘K) via sendInputEvent.
 */
export function runScreenshotTour(win: () => BrowserWindow | null, push: PushFn): void {
  const outDir = process.env.NOCTUA_SHOT_DIR || join(app.getPath('temp'), 'noctua-shots')
  mkdirSync(outDir, { recursive: true })

  const key = (keyCode: string, modifiers: Array<'meta' | 'shift'> = []): void => {
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

  const click = (x: number, y: number): void => {
    const w = win()
    if (!w) return
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  const shot = async (name: string): Promise<void> => {
    const w = win()
    if (!w) return
    const image = await w.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    console.log(`[shots] ${name}.png`)
  }

  const go = (action: PushPayload<'app:menuAction'>['action']): void =>
    push('app:menuAction', { action })

  setTimeout(() => {
    void (async () => {
      try {
        go('inbox')
        await wait(1800)
        await shot('01-inbox')

        // Folder filter: click the SENT segment (segmented control top left)
        click(198, 104)
        await wait(2600)
        await shot('01b-sent')
        click(323, 104)
        await wait(2200)
        await shot('01c-spam')
        click(75, 104)
        await wait(900)

        // Dictation strip (v) — listening state
        key('V')
        await wait(900)
        await shot('02-listening')
        key('Escape')
        await wait(500)

        go('waiting')
        await wait(2200)
        await shot('03-waiting')

        go('tasks')
        await wait(1200)
        await shot('04-tasks')

        // Space toggle: select the first task, check it off and jump to the next
        click(198, 110)
        await wait(600)
        key('Space')
        await wait(900)
        await shot('04b-task-toggled')

        go('settings')
        await wait(1200)
        await shot('05-settings-accounts')

        key('J')
        await wait(800)
        await shot('06-settings-style')

        key('J')
        await wait(900)
        await shot('06b-settings-sig')

        key('J')
        await wait(1400)
        await shot('07-settings-intel')

        go('chat')
        await wait(1200)
        await shot('08-chat')

        go('compose')
        await wait(1400)
        await shot('10-composer')
        key('Escape')
        await wait(600)

        go('inbox')
        await wait(800)
        key('k', ['meta'])
        await wait(900)
        await shot('11-palette')
        typeText('bollerwagen')
        await wait(1400)
        await shot('11b-search')
        key('Escape')
        await wait(500)

        key('?', ['shift'])
        await wait(900)
        await shot('12-help')
        key('Escape')
        await wait(400)

        console.log('[shots] fertig:', outDir)
      } catch (error) {
        console.error('[shots] Tour fehlgeschlagen:', error)
      }
    })()
  }, 9000)
}
