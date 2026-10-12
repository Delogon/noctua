import { app, BrowserWindow, dialog, powerMonitor, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb, closeDb } from './db'
import { DatabaseTooNewError } from './db/migrate'
import { DbKeyError } from './db/encryption'
import { registerIpcHandlers, pushToWindow } from './ipc/register'
import { handlers, setHandlerPush } from './ipc/handlers'
import { seedFromEnv } from './auth/seed'
import { syncEngine } from './sync/engine'
import { aiQueue } from './ai/queue'
import { followupRadar } from './ai/followups'
import { embeddingIndexer } from './ai/embeddings'
import { outboxWorker } from './smtp/outbox'
import { initNotifications, notifyCalendarReminder, updateBadge } from './notifications'
import { initCalendar, stopCalendar } from './calendar'
import { setItipMailer } from './calendar/mailer'
import { calendarSync } from './calendar/sync'
import { setRuleActionExecutor } from './ai/rules'
import { setJunkExecutor } from './ai/threat-check'
import { startUpdateChecks, stopUpdateChecks } from './updates'
import { appId, packagedAppName, productName } from './org-config'
import { applyOrgConfig } from './org-defaults'
import { stopAppleFm } from './ai/apple-fm'
import { openExternalSafe } from './util/links'
import { installAppMenu } from './menu'
import { cleanupForwardTasksWithoutRequest } from './db/repos/tasks'
import { reindexHtmlOnlyMessages } from './mail/ingest'
import { isDev } from './dev-mode'
import { diagnostics } from './diagnostics/service'
import { diagnosticsAppInfo } from './diagnostics/app-info'
import { metrics } from './diagnostics/metrics'
import { trafficLightPosition } from './window-chrome'
import {
  APP_CSP,
  isPermissionAllowed,
  isTrustedAppUrl,
  safeDevRendererUrl,
  type TrustedAppPages
} from './security'

// Deliberately NO app.setName('Noctua'): that would change the existing userData/
// safe-storage names. In dev, scripts/prepare-dev-app.mjs provides the Noctua
// identity for macOS without bending the internal package name.

// Dev detection (isDev) lives in dev-mode.ts; ELECTRON_RENDERER_URL only counts
// in dev mode and only for loopback hosts — a production build never loads
// a remote renderer.
const devRendererUrl = isDev ? safeDevRendererUrl(process.env['ELECTRON_RENDERER_URL']) : null

/** Trusted app pages: the built index.html or the dev server. */
const trustedPages = (): TrustedAppPages => ({
  indexPath: join(__dirname, '../renderer/index.html'),
  devUrl: devRendererUrl
})

// The packaged app gets its OWN data directory (+ its own safe-storage key):
// dev already uses "noctua", and since macOS file systems are case-insensitive,
// "Noctua" would hit the same DB — two instances on one DB means lock
// conflicts and duplicate IMAP sync.
// A Company Edition (org configuration) in turn gets its own name.
if (!isDev) app.setName(packagedAppName())

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    // Letterpress design: layout is built for >=1180px (README handoff)
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: productName(),
    backgroundColor: '#F4F1EA',
    titleBarStyle: 'hiddenInset',
    // Start with the Letterpress position; the renderer reports a different layout
    // via app:setWindowChrome (window-chrome.ts explains the values).
    trafficLightPosition: trafficLightPosition('letterpress'),
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security baseline: renderer is fully isolated, no Node access.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // <webview> would be a second renderer layer that is hard to secure
      webviewTag: false
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    // Mirror the renderer console to the terminal — errors in the sandboxed renderer
    // would otherwise only be visible in DevTools.
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
  }

  // The renderer may never navigate or open windows; external links go
  // exclusively through the system browser (https/mailto only).
  win.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
    return { action: 'deny' }
  })
  // Navigation and redirects only within our own app page (reload, HMR)
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
 * Session hardening: permissions denied by default (only the microphone for
 * dictation, only for our own app page) and CSP additionally as a response header
 * for the app pages — the meta CSP in index.html remains as a second layer.
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
    // Check requests carry mediaType instead of mediaTypes
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
    // Only for the built app (file://). The Vite dev server injects an inline script
    // (React Refresh preamble) before the <meta> CSP — a header CSP would block it;
    // so in dev mode only the <meta> CSP from index.html applies, as before.
    if (
      details.resourceType === 'mainFrame' &&
      details.url.startsWith('file:') &&
      isTrustedAppUrl(details.url, trustedPages())
    ) {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [APP_CSP] }
      })
      return
    }
    callback({})
  })
}

// Second instance of the installed app: focus the first, the new one quits.
// No lock in dev mode — there scripts/dev.sh deliberately replaces old instances.
if (!isDev) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      // After the window is closed (macOS: app keeps running) mainWindow is
      // destroyed — then the second launch opens a new window instead of dying
      // with "Object has been destroyed".
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
  .then(async () => {
    electronApp.setAppUserModelId(appId())

    const db = openDb()
    // Local performance diagnostics (on-device only; ZIP export on request)
    diagnostics.init({
      db,
      dbPath: join(app.getPath('userData'), 'noctua.sqlite'),
      dir: join(app.getPath('userData'), 'diagnostics'),
      appInfo: diagnosticsAppInfo,
      getAppMetrics: () => app.getAppMetrics()
    })
    // Org defaults + provisioned AI profiles (no-op without org configuration)
    applyOrgConfig(db, app.getLocale())
    metrics.time('startup.cleanupForwardTasks', () => cleanupForwardTasksWithoutRequest(db))
    metrics.time('startup.reindexHtmlOnly', () => reindexHtmlOnlyMessages(db))
    if (isDev) seedFromEnv(db)
    // Dev-only demo data (NOCTUA_DEMO_SEED=1): no IMAP/CalDAV sync for demo accounts
    const demo = isDev && process.env.NOCTUA_DEMO_SEED === '1'
    if (demo) await (await import('./dev/demo-seed')).seedDemoData(db)
    installSessionSecurity()
    registerIpcHandlers(handlers, () => mainWindow, trustedPages)

    const push: Parameters<typeof syncEngine.init>[1] = (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) pushToWindow(mainWindow, channel, payload)
    }
    syncEngine.init(db, (channel, payload) => {
      push(channel, payload)
      // New/updated messages may have become eligible for triage/indexing.
      if (channel === 'messages:changed') {
        metrics.count('events.messagesChanged')
        metrics.count(
          'events.messagesChanged.threadKeys',
          (payload as { threadKeys?: string[] }).threadKeys?.length ?? 0
        )
        aiQueue.kick()
        embeddingIndexer.kick()
        updateBadge()
      }
    })
    if (!demo) syncEngine.startAll()

    aiQueue.init(db, push)
    if (!demo) aiQueue.start()
    setHandlerPush(push)
    installAppMenu(push, () => mainWindow)
    if (isDev && process.platform === 'darwin') {
      // Fallback while the dev bundle cache is being rebuilt.
      app.dock?.setIcon(icon)
    }

    followupRadar.init(db, push)
    followupRadar.start()

    embeddingIndexer.init(db)
    if (!demo) embeddingIndexer.start()

    outboxWorker.init(db, push)
    outboxWorker.start()
    initNotifications(db, push)
    initCalendar(db, push, notifyCalendarReminder, { startSync: !demo })
    // iMIP (invitations/replies) goes through the outbox, without an undo window
    setItipMailer((accountId, mail) => {
      outboxWorker.enqueue(
        accountId,
        {
          to: mail.to,
          cc: [],
          subject: mail.subject,
          textBody: mail.text,
          icalEvent: { method: mail.method, content: mail.ics }
        },
        { immediate: true }
      )
    })
    setRuleActionExecutor((ids, action) => syncEngine.applyAction(ids, action))
    setJunkExecutor((ids) => syncEngine.applyAction(ids, 'spam'))
    if (!demo) startUpdateChecks(push)

    if (isDev && process.env.NOCTUA_TEST_SELF_SEND === '1') {
      void import('./dev/self-test').then(({ runSelfSendTest }) => runSelfSendTest(db))
    }
    if (isDev && process.env.NOCTUA_TEST_DRAFT === '1') {
      void import('./dev/self-test').then(({ runDraftTest }) => runDraftTest(db))
    }
    if (isDev && process.env.NOCTUA_TEST_SHOTS === 'demo') {
      void import('./dev/demo-tour').then(({ runDemoTour }) => runDemoTour(() => mainWindow, push))
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
          // Thread in which Tim is addressed formally (Stadt Oldenburg / Grossflaechentafeln)
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

    powerMonitor.on('resume', () => {
      syncEngine.wakeAll()
      calendarSync.wakeAll()
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    // Without this catch the app would hang windowless in the Dock on startup errors
    // (unhandled rejection) — this way the error gets a face.
    dialog.showErrorBox(
      'Noctua kann nicht starten',
      error instanceof DatabaseTooNewError || error instanceof DbKeyError
        ? error.message
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error)
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  diagnostics.persist()
  diagnostics.stop()
  aiQueue.stop()
  followupRadar.stop()
  embeddingIndexer.stop()
  outboxWorker.stop()
  stopUpdateChecks()
  stopAppleFm()
  void syncEngine.stopAll()
  stopCalendar()
  closeDb()
})
