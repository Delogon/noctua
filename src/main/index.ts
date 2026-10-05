import { app, BrowserWindow, dialog, powerMonitor, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb, closeDb } from './db'
import { registerIpcHandlers, pushToWindow } from './ipc/register'
import { handlers, setHandlerPush } from './ipc/handlers'
import { seedFromEnv } from './auth/seed'
import { syncEngine } from './sync/engine'
import { aiQueue } from './ai/queue'
import { followupRadar } from './ai/followups'
import { embeddingIndexer } from './ai/embeddings'
import { outboxWorker } from './smtp/outbox'
import { initNotifications, updateBadge } from './notifications'
import { setRuleActionExecutor } from './ai/rules'
import { startUpdateChecks, stopUpdateChecks } from './updates'
import { stopAppleFm } from './ai/apple-fm'
import { openExternalSafe } from './util/links'
import { installAppMenu } from './menu'
import { cleanupForwardTasksWithoutRequest } from './db/repos/tasks'
import { reindexHtmlOnlyMessages } from './mail/ingest'
import { isDev } from './dev-mode'
import {
  APP_CSP,
  isPermissionAllowed,
  isTrustedAppUrl,
  safeDevRendererUrl,
  type TrustedAppPages
} from './security'

// Bewusst KEIN app.setName('Noctua'): das würde den bestehenden userData-/
// Safe-Storage-Namen verändern. Im Dev liefert scripts/prepare-dev-app.mjs die
// Noctua-Identität für macOS, ohne den internen Paketnamen umzubiegen.

// Dev-Erkennung (isDev) liegt in dev-mode.ts; ELECTRON_RENDERER_URL zählt nur
// im Dev-Modus und nur für Loopback-Hosts — ein Produktions-Build lädt nie
// einen entfernten Renderer.
const devRendererUrl = isDev ? safeDevRendererUrl(process.env['ELECTRON_RENDERER_URL']) : null

/** Vertrauenswürdige App-Seiten: gebaute index.html bzw. der Dev-Server. */
const trustedPages = (): TrustedAppPages => ({
  indexPath: join(__dirname, '../renderer/index.html'),
  devUrl: devRendererUrl
})

// Die verpackte App bekommt ein EIGENES Datenverzeichnis (+ eigenen Safe-
// Storage-Schlüssel): Dev belegt bereits „noctua", und da macOS-Dateisysteme
// Groß-/Kleinschreibung ignorieren, würde auch „Noctua" dieselbe DB treffen —
// zwei Instanzen auf einer DB heißt Lock-Konflikte und doppelter IMAP-Sync.
if (!isDev) app.setName('noctua-prod')

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    // Letterpress-Design: Layout ist für >=1180px gebaut (README Handoff)
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: 'Noctua',
    backgroundColor: '#F4F1EA',
    titleBarStyle: 'hiddenInset',
    // Traffic lights vertically centered on the masthead wordmark: its box
    // spans 18–42px (center 30), the buttons are 12px tall → top at 24.
    trafficLightPosition: { x: 16, y: 24 },
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security-Baseline: Renderer ist vollständig isoliert, kein Node-Zugriff.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // <webview> wäre eine zweite, schwer abzusichernde Renderer-Ebene
      webviewTag: false
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    // Renderer-Konsole ins Terminal spiegeln — Fehler im sandboxed Renderer
    // wären sonst nur in den DevTools sichtbar.
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
  }

  // Renderer darf nie navigieren oder Fenster öffnen; externe Links gehen
  // ausschließlich über den System-Browser (nur https/mailto).
  win.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
    return { action: 'deny' }
  })
  // Navigation und Redirects nur innerhalb der eigenen App-Seite (Reload, HMR)
  const guardNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (!isTrustedAppUrl(url, trustedPages())) event.preventDefault()
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (devRendererUrl) {
    win.loadURL(devRendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * Session-Härtung: Berechtigungen standardmäßig verboten (nur Mikrofon für das
 * Diktat, nur für die eigene App-Seite) und CSP zusätzlich als Response-Header
 * für die App-Seiten — die Meta-CSP in index.html bleibt als zweite Schicht.
 */
function installSessionSecurity(): void {
  const ses = session.defaultSession
  const fromMain = (wc: Electron.WebContents | null): boolean =>
    !!wc && !!mainWindow && !mainWindow.isDestroyed() && wc === mainWindow.webContents

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    callback(
      isPermissionAllowed({
        permission,
        mediaTypes,
        fromMainWindow: fromMain(wc),
        requestingUrl: details.requestingUrl,
        pages: trustedPages()
      })
    )
  })
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // Check-Requests tragen mediaType statt mediaTypes
    const mediaType = (details as { mediaType?: string }).mediaType
    return isPermissionAllowed({
      permission,
      mediaTypes: mediaType ? [mediaType] : undefined,
      fromMainWindow: fromMain(wc),
      requestingUrl: details.requestingUrl || requestingOrigin,
      pages: trustedPages()
    })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' && isTrustedAppUrl(details.url, trustedPages())) {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [APP_CSP] }
      })
      return
    }
    callback({})
  })
}

// Zweite Instanz der installierten App: erste fokussieren, neue beendet sich.
// Im Dev-Modus kein Lock — dort ersetzt scripts/dev.sh alte Instanzen bewusst.
if (!isDev) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      // Nach dem Schließen des Fensters (macOS: App lebt weiter) ist mainWindow
      // zerstört — dann öffnet der zweite Start ein neues Fenster statt mit
      // „Object has been destroyed" zu sterben.
      const win = mainWindow
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      } else if (app.isReady()) {
        createWindow()
      }
    })
  }
}

app
  .whenReady()
  .then(() => {
    electronApp.setAppUserModelId('de.timsigl.noctua')

    const db = openDb()
    cleanupForwardTasksWithoutRequest(db)
    reindexHtmlOnlyMessages(db)
    if (isDev) seedFromEnv(db)
    installSessionSecurity()
    registerIpcHandlers(handlers, () => mainWindow, trustedPages)

    const push: Parameters<typeof syncEngine.init>[1] = (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) pushToWindow(mainWindow, channel, payload)
    }
    syncEngine.init(db, (channel, payload) => {
      push(channel, payload)
      // Neue/aktualisierte Nachrichten können triage-/index-fähig geworden sein.
      if (channel === 'messages:changed') {
        aiQueue.kick()
        embeddingIndexer.kick()
        updateBadge()
      }
    })
    syncEngine.startAll()

    aiQueue.init(db, push)
    aiQueue.start()
    setHandlerPush(push)
    installAppMenu(push, () => mainWindow)
    if (isDev && process.platform === 'darwin') {
      // Fallback während der Dev-Bundle-Cache neu aufgebaut wird.
      app.dock?.setIcon(icon)
    }

    followupRadar.init(db, push)
    followupRadar.start()

    embeddingIndexer.init(db)
    embeddingIndexer.start()

    outboxWorker.init(db, push)
    outboxWorker.start()
    initNotifications(db, push)
    setRuleActionExecutor((ids, action) => syncEngine.applyAction(ids, action))
    startUpdateChecks(push)

    if (isDev && process.env.NOCTUA_TEST_SELF_SEND === '1') {
      void import('./dev/self-test').then(({ runSelfSendTest }) => runSelfSendTest(db))
    }
    if (isDev && process.env.NOCTUA_TEST_DRAFT === '1') {
      void import('./dev/self-test').then(({ runDraftTest }) => runDraftTest(db))
    }
    if (isDev && process.env.NOCTUA_TEST_SHOTS === '1') {
      void import('./dev/screenshot-tour').then(({ runScreenshotTour }) =>
        runScreenshotTour(() => mainWindow, push)
      )
    }
    if (isDev && process.env.NOCTUA_TEST_DRAFT_NEW === '1') {
      void import('./dev/self-test').then(({ runDraftNewTest }) => runDraftNewTest(db))
    }
    if (isDev && process.env.NOCTUA_TEST_CHAT) {
      void import('./dev/self-test').then(({ runChatTest }) =>
        runChatTest(db, process.env.NOCTUA_TEST_CHAT!)
      )
    }
    if (isDev && process.env.NOCTUA_TEST_STYLE) {
      const accId = Number(process.env.NOCTUA_TEST_STYLE)
      setTimeout(() => {
        void import('./ai/style').then(({ refreshStyleProfile }) =>
          refreshStyleProfile(db, accId)
            .then((p) => console.log('[style-test] OK:', JSON.stringify(p)?.slice(0, 300)))
            .catch((e) => console.error('[style-test] FEHLER:', e))
        )
      }, 4000)
    }
    if (isDev && process.env.NOCTUA_TEST_REVISE === '1') {
      setTimeout(() => {
        void (async () => {
          const { startDraftReply } = await import('./ai/drafts')
          const row = db
            .prepare(
              `SELECT m.thread_key k FROM messages m JOIN folders f ON f.id = m.folder_id
             WHERE f.special_use = '\\Inbox' ORDER BY m.date DESC LIMIT 1`
            )
            .get() as { k: string } | undefined
          if (!row) return console.error('[revise-test] kein Thread')
          let out = ''
          const push = ((
            channel: string,
            payload: { chunk?: string; done?: boolean; error?: string | null }
          ): void => {
            if (channel !== 'ai:draftChunk') return
            out += payload.chunk ?? ''
            if (payload.error) console.error('[revise-test] FEHLER:', payload.error)
            else if (payload.done)
              console.log('[revise-test] OK:', JSON.stringify(out).slice(0, 400))
          }) as Parameters<typeof startDraftReply>[1]
          startDraftReply(db, push, {
            threadKey: row.k,
            idea: 'Ergänze bitte, dass ich die Unterlagen erst am Montag schicken kann.',
            reviseText:
              'Hallo,\n\nvielen Dank für die Nachricht. Ich kümmere mich darum und melde mich mit den Details.\n\nViele Grüße\nTim'
          })
        })().catch((e) => console.error('[revise-test] FEHLER:', e))
      }, 5000)
    }
    if (isDev && process.env.NOCTUA_TEST_FORMALITY === '1') {
      setTimeout(() => {
        void (async () => {
          const { startDraftReply } = await import('./ai/drafts')
          // Thread, in dem Tim gesiezt wird (Stadt Oldenburg / Grossflaechentafeln)
          const row = db
            .prepare(
              `SELECT m.thread_key k FROM messages m JOIN message_bodies b ON b.message_id = m.id
             WHERE b.text_plain LIKE '%Ihnen%' AND m.from_addr LIKE '%stadt-oldenburg%'
             ORDER BY m.date DESC LIMIT 1`
            )
            .get() as { k: string } | undefined
          if (!row) return console.error('[formality-test] kein Sie-Thread gefunden')
          let out = ''
          const push = ((
            channel: string,
            payload: { chunk?: string; done?: boolean; error?: string | null }
          ): void => {
            if (channel !== 'ai:draftChunk') return
            out += payload.chunk ?? ''
            if (payload.error) console.error('[formality-test] FEHLER:', payload.error)
            else if (payload.done)
              console.log('[formality-test] OK:', JSON.stringify(out).slice(0, 500))
          }) as Parameters<typeof startDraftReply>[1]
          startDraftReply(db, push, { threadKey: row.k })
        })().catch((e) => console.error('[formality-test] FEHLER:', e))
      }, 5000)
    }
    if (isDev && process.env.NOCTUA_TEST_M10 === '1') {
      void import('./dev/self-test').then(({ runM10Test }) => runM10Test(db))
    }

    powerMonitor.on('resume', () => syncEngine.wakeAll())

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    // Ohne diesen Catch bliebe die App bei Startfehlern fensterlos im Dock
    // hängen (unhandled rejection) — so bekommt der Fehler ein Gesicht.
    dialog.showErrorBox(
      'Noctua kann nicht starten',
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  aiQueue.stop()
  followupRadar.stop()
  embeddingIndexer.stop()
  outboxWorker.stop()
  stopUpdateChecks()
  stopAppleFm()
  void syncEngine.stopAll()
  closeDb()
})
