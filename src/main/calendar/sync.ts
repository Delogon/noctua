import type Database from 'better-sqlite3-multiple-ciphers'
import {
  DavAuthError,
  DavClient,
  DavHttpError,
  DavTransportError,
  fetchEtag,
  listCalendars,
  multiget,
  queryEtags,
  syncCollection,
  SyncTokenInvalidError,
  type DavCalendarInfo,
  type EtagEntry,
  type FetchLike
} from '../dav'
import { getSecret } from '../auth/secrets'
import {
  calSecretKey,
  deleteObject,
  ensureInstanceWindow,
  getCalAccount,
  getCalendar,
  getObject,
  listPendingOps,
  MAX_CAL_OP_ATTEMPTS,
  upsertObject,
  type CalAccountRow,
  type CalendarRow,
  type CalObjectRow,
  type PendingOpRow
} from './repo'

/**
 * Sync-Engine des Kalenders (Phase 2.1).
 *
 * Ablauf je Konto-Lauf: (1) lokale Änderungen übertragen (cal_pending_ops),
 * (2) Kalenderliste abgleichen, (3) je Kalender ctag prüfen und dann
 * inkrementell per sync-collection (RFC 6578) oder — ohne Unterstützung bzw.
 * bei ungültigem Token — per ETag-Vergleich (calendar-query + multiget).
 * Siehe docs/CALDAV.md.
 */

export type CalSyncState = 'idle' | 'connecting' | 'syncing' | 'error' | 'needs-reauth' | 'off'

export interface ConflictInfo {
  accountId: number
  calendarId: number
  uid: string
  summary: string | null
  kind: 'create' | 'update' | 'delete'
  reason: 'conflict' | 'deleted-on-server' | 'forbidden' | 'attempts'
}

export interface SyncEvents {
  /** calendarIds leer = Kalenderliste hat sich geändert */
  onChanged(accountId: number, calendarIds: number[]): void
  onConflict(info: ConflictInfo): void
}

export interface SyncContext {
  db: Database.Database
  client: DavClient
  events: SyncEvents
}

const MAX_SYNC_PAGES = 50

// --- Kalenderliste -------------------------------------------------------------------------

/** Kalenderliste des Servers abgleichen. Liefert die Zeilen samt Server-Zustand. */
export async function refreshCalendarList(
  ctx: SyncContext,
  account: CalAccountRow
): Promise<{ rows: Array<{ row: CalendarRow; info: DavCalendarInfo }>; listChanged: boolean }> {
  const { db } = ctx
  const infos = await listCalendars(ctx.client, account.home_url)
  const existing = db
    .prepare('SELECT * FROM calendars WHERE account_id = ?')
    .all(account.id) as CalendarRow[]
  const byUrl = new Map(existing.map((c) => [c.url, c]))
  let listChanged = false

  const tx = db.transaction(() => {
    infos.forEach((info, index) => {
      const current = byUrl.get(info.url)
      const components = info.components.join(',')
      if (!current) {
        db.prepare(
          `INSERT INTO calendars (account_id, url, display_name, color, components, read_only,
             supports_sync, visible, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(
          account.id,
          info.url,
          info.displayName ?? lastSegment(info.url),
          info.color,
          components,
          info.readOnly ? 1 : 0,
          info.supportsSyncCollection ? 1 : 0,
          info.order ?? index
        )
        listChanged = true
      } else {
        const name = info.displayName ?? lastSegment(info.url)
        const color = current.color_user_set ? current.color : info.color
        if (
          current.display_name !== name ||
          current.color !== color ||
          current.components !== components ||
          current.read_only !== (info.readOnly ? 1 : 0)
        ) {
          listChanged = true
        }
        db.prepare(
          `UPDATE calendars SET display_name = ?, color = ?, components = ?, read_only = ?,
             supports_sync = ?, sort_order = ? WHERE id = ?`
        ).run(
          name,
          color,
          components,
          info.readOnly ? 1 : 0,
          info.supportsSyncCollection ? 1 : 0,
          info.order ?? index,
          current.id
        )
      }
    })
    // Gelöschte Kalender entfernen — nicht bei leerer Antwort (Server-Aussetzer)
    if (infos.length > 0) {
      const present = new Set(infos.map((i) => i.url))
      for (const cal of existing) {
        if (!present.has(cal.url)) {
          db.prepare('DELETE FROM calendars WHERE id = ?').run(cal.id)
          listChanged = true
        }
      }
    }
  })
  tx()

  const rows = infos.map((info) => ({
    info,
    row: db
      .prepare('SELECT * FROM calendars WHERE account_id = ? AND url = ?')
      .get(account.id, info.url) as CalendarRow
  }))
  return { rows, listChanged }
}

function lastSegment(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? 'Kalender')
}

// --- Kalender abgleichen -----------------------------------------------------------------------

interface Collected {
  mode: 'full' | 'delta'
  entries: Map<string, string | null>
  removed: Set<string>
  syncToken: string | null
}

async function collectChanges(
  ctx: SyncContext,
  cal: CalendarRow,
  info: DavCalendarInfo
): Promise<Collected> {
  const useSync = info.supportsSyncCollection || cal.supports_sync === 1
  if (useSync) {
    let token = cal.sync_token
    for (let attempt = 0; attempt < 2; attempt++) {
      const entries = new Map<string, string | null>()
      const removed = new Set<string>()
      const mode: 'full' | 'delta' = token ? 'delta' : 'full'
      try {
        for (let page = 0; page < MAX_SYNC_PAGES; page++) {
          const res = await syncCollection(ctx.client, cal.url, token)
          for (const e of res.changed) {
            entries.set(e.href, e.etag)
            removed.delete(e.href)
          }
          for (const href of res.removed) {
            removed.add(href)
            entries.delete(href)
          }
          if (res.syncToken) token = res.syncToken
          if (!res.truncated) return { mode, entries, removed, syncToken: token }
        }
        // zu viele Seiten: lieber sauber per ETag abgleichen
        break
      } catch (error) {
        if (error instanceof SyncTokenInvalidError && cal.sync_token && attempt === 0) {
          token = null // Token ungültig → vollständiger Neuabgleich
          continue
        }
        if (
          error instanceof DavHttpError &&
          [400, 403, 404, 405, 415, 501].includes(error.status)
        ) {
          // Server kann sync-collection nicht: dauerhaft auf ETag-Abgleich umstellen
          ctx.db.prepare('UPDATE calendars SET supports_sync = 0 WHERE id = ?').run(cal.id)
          break
        }
        throw error
      }
    }
  }
  // Fallback: ctag + ETag-Vergleich
  const list = await queryEtags(ctx.client, cal.url)
  const entries = new Map<string, string | null>(list.map((e: EtagEntry) => [e.href, e.etag]))
  return { mode: 'full', entries, removed: new Set(), syncToken: null }
}

/** Gleicht einen Kalender ab. Rückgabe: true, wenn sich lokale Daten geändert haben. */
export async function syncCalendar(
  ctx: SyncContext,
  cal: CalendarRow,
  info: DavCalendarInfo,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  const { db } = ctx
  const unchanged =
    (info.ctag !== null && info.ctag === cal.ctag) ||
    (info.ctag === null && info.syncToken !== null && info.syncToken === cal.sync_token)
  if (unchanged && !opts.force) return false

  const collected = await collectChanges(ctx, cal, info)

  const local = new Map(
    (
      db
        .prepare('SELECT id, href, etag, pending_op FROM cal_objects WHERE calendar_id = ?')
        .all(cal.id) as Array<Pick<CalObjectRow, 'id' | 'href' | 'etag' | 'pending_op'>>
    ).map((o) => [o.href, o])
  )

  // Lokale, noch nicht übertragene Änderungen haben Vorrang (Konflikt beim Push über If-Match)
  const toFetch: string[] = []
  for (const [href, etag] of collected.entries) {
    const l = local.get(href)
    if (l?.pending_op) continue
    if (!l || etag === null || l.etag !== etag) toFetch.push(href)
  }
  // Zurückgerollte lokale Änderungen (etag = NULL) von der Server-Fassung neu laden
  for (const [href, l] of local) {
    if (l.etag === null && !l.pending_op && !toFetch.includes(href)) toFetch.push(href)
  }
  const fetched = toFetch.length > 0 ? await multiget(ctx.client, cal.url, toFetch) : []

  let changed = false
  const apply = db.transaction(() => {
    for (const obj of fetched) {
      const listedEtag = collected.entries.get(obj.href) ?? null
      upsertObject(db, {
        calendarId: cal.id,
        href: obj.href,
        etag: obj.etag ?? listedEtag,
        ics: obj.ics
      })
      changed = true
    }
    const toRemove: number[] = []
    if (collected.mode === 'full') {
      for (const [href, l] of local) {
        if (!collected.entries.has(href) && !l.pending_op) toRemove.push(l.id)
      }
    } else {
      for (const href of collected.removed) {
        const l = local.get(href)
        if (l && !l.pending_op) toRemove.push(l.id)
      }
    }
    for (const id of toRemove) {
      deleteObject(db, id)
      changed = true
    }
    db.prepare('UPDATE calendars SET ctag = ?, sync_token = ? WHERE id = ?').run(
      info.ctag,
      collected.syncToken,
      cal.id
    )
  })
  apply()
  return changed
}

/** Kompletter Lauf für ein Konto. */
export async function syncAccount(
  ctx: SyncContext,
  account: CalAccountRow,
  opts: { force?: boolean } = {}
): Promise<void> {
  await pushPendingOps(ctx, account)
  const { rows, listChanged } = await refreshCalendarList(ctx, account)
  const changedIds: number[] = []
  let firstError: unknown = null
  for (const { row, info } of rows) {
    try {
      if (await syncCalendar(ctx, row, info, opts)) changedIds.push(row.id)
    } catch (error) {
      // Auth-/Netzfehler beenden den Lauf; Einzelfehler eines Kalenders nicht
      if (error instanceof DavAuthError || error instanceof DavTransportError) throw error
      console.warn(
        `[calendar] Sync von „${row.display_name}“ fehlgeschlagen:`,
        error instanceof Error ? error.message : error
      )
      firstError ??= error
    }
  }
  if (listChanged || changedIds.length > 0) {
    ctx.events.onChanged(account.id, listChanged ? [] : changedIds)
    if (listChanged && changedIds.length > 0) ctx.events.onChanged(account.id, changedIds)
  }
  if (firstError) throw firstError
}

// --- Lokale Änderungen übertragen ------------------------------------------------------------------

function objectUrl(cal: CalendarRow, href: string): string {
  return new URL(href, cal.url).toString()
}

const ICS_TYPE = 'text/calendar; charset=utf-8'
const PERMANENT_STATUS = new Set([403, 405, 409, 415])

function markDead(
  db: Database.Database,
  op: PendingOpRow,
  reason: ConflictInfo['reason'],
  detail: string,
  ics: string | null
): void {
  db.prepare(
    `UPDATE cal_pending_ops SET status = 'dead', last_error = ?, ics = COALESCE(?, ics) WHERE id = ?`
  ).run(`${reason}: ${detail}`.slice(0, 500), ics, op.id)
}

/** Server-Fassung laden und lokal übernehmen; null, wenn die Ressource dort nicht (mehr) existiert. */
async function adoptServerVersion(
  ctx: SyncContext,
  cal: CalendarRow,
  href: string
): Promise<boolean> {
  try {
    const got = await ctx.client.get(objectUrl(cal, href))
    upsertObject(ctx.db, { calendarId: cal.id, href, etag: got.etag, ics: got.text })
    return true
  } catch (error) {
    if (error instanceof DavHttpError && (error.status === 404 || error.status === 410))
      return false
    throw error
  }
}

async function pushOp(
  ctx: SyncContext,
  account: CalAccountRow,
  op: PendingOpRow,
  cal: CalendarRow
): Promise<void> {
  const { db, client } = ctx
  const obj = op.object_id ? getObject(db, op.object_id) : undefined
  const url = objectUrl(cal, op.href)
  const report = (reason: ConflictInfo['reason']): void =>
    ctx.events.onConflict({
      accountId: account.id,
      calendarId: cal.id,
      uid: op.uid,
      summary: op.summary,
      kind: op.kind,
      reason
    })

  if (op.kind === 'delete') {
    try {
      await client.delete(url, op.base_etag)
    } catch (error) {
      if (error instanceof DavHttpError && (error.status === 404 || error.status === 410)) {
        // schon weg
      } else if (error instanceof DavHttpError && error.status === 412) {
        // Server-Stand hat sich geändert: Löschung verwerfen, Server-Fassung behalten
        const exists = await adoptServerVersion(ctx, cal, op.href)
        markDead(db, op, exists ? 'conflict' : 'deleted-on-server', 'Server-Version geändert', null)
        if (obj && !exists) deleteObject(db, obj.id)
        report(exists ? 'conflict' : 'deleted-on-server')
        return
      } else {
        throw error
      }
    }
    if (obj) deleteObject(db, obj.id)
    db.prepare('DELETE FROM cal_pending_ops WHERE id = ?').run(op.id)
    return
  }

  if (!obj) {
    // Objekt wurde zwischenzeitlich vom Server entfernt
    db.prepare('DELETE FROM cal_pending_ops WHERE id = ?').run(op.id)
    return
  }

  try {
    const res = await client.put(url, obj.ics, {
      contentType: ICS_TYPE,
      ifNoneMatch: op.kind === 'create',
      ifMatch: op.kind === 'update' ? op.base_etag : undefined
    })
    let etag = res.etag
    let ics = obj.ics
    if (!etag) {
      // Kein ETag im Response: Server hat den Inhalt evtl. umgeschrieben → neu laden
      try {
        const got = await client.get(url)
        etag = got.etag
        ics = got.text
      } catch {
        etag = await fetchEtag(client, url).catch(() => null)
      }
    }
    upsertObject(db, { calendarId: cal.id, href: op.href, etag, ics, pendingOp: null })
    db.prepare('DELETE FROM cal_pending_ops WHERE id = ?').run(op.id)
  } catch (error) {
    if (error instanceof DavHttpError && error.status === 412) {
      if (op.kind === 'create') {
        markDead(db, op, 'conflict', 'Ressource existiert bereits', obj.ics)
        deleteObject(db, obj.id)
        report('conflict')
        return
      }
      // Konflikt: Server-Fassung gewinnt, die lokale bleibt zur Diagnose in der Op
      const mine = obj.ics
      const exists = await adoptServerVersion(ctx, cal, op.href)
      if (!exists) deleteObject(db, obj.id)
      markDead(db, op, exists ? 'conflict' : 'deleted-on-server', 'If-Match fehlgeschlagen', mine)
      report(exists ? 'conflict' : 'deleted-on-server')
      return
    }
    if (error instanceof DavHttpError && PERMANENT_STATUS.has(error.status)) {
      markDead(db, op, 'forbidden', `HTTP ${error.status}`, obj.ics)
      if (op.kind === 'create') deleteObject(db, obj.id)
      else
        db.prepare('UPDATE cal_objects SET etag = NULL, pending_op = NULL WHERE id = ?').run(obj.id)
      // etag = NULL erzwingt beim nächsten Sync das Neuladen der Server-Fassung
      db.prepare('UPDATE calendars SET ctag = NULL WHERE id = ?').run(cal.id)
      report('forbidden')
      return
    }
    throw error
  }
}

/** Überträgt wartende lokale Änderungen. Netz-/Auth-Fehler brechen ab, ohne Versuche zu verbrennen. */
export async function pushPendingOps(ctx: SyncContext, account: CalAccountRow): Promise<number> {
  const ops = listPendingOps(ctx.db, account.id)
  let pushed = 0
  const touched = new Set<number>()
  for (const op of ops) {
    const cal = getCalendar(ctx.db, op.calendar_id)
    if (!cal) {
      ctx.db.prepare('DELETE FROM cal_pending_ops WHERE id = ?').run(op.id)
      continue
    }
    try {
      await pushOp(ctx, account, op, cal)
      touched.add(cal.id)
      pushed += 1
    } catch (error) {
      if (error instanceof DavAuthError || error instanceof DavTransportError) throw error
      const message = error instanceof Error ? error.message : String(error)
      const attempts = op.attempts + 1
      if (attempts >= MAX_CAL_OP_ATTEMPTS) {
        markDead(ctx.db, op, 'attempts', message, null)
        const obj = op.object_id ? getObject(ctx.db, op.object_id) : undefined
        if (obj) {
          if (op.kind === 'create') deleteObject(ctx.db, obj.id)
          else
            ctx.db
              .prepare('UPDATE cal_objects SET etag = NULL, pending_op = NULL WHERE id = ?')
              .run(obj.id)
          ctx.db.prepare('UPDATE calendars SET ctag = NULL WHERE id = ?').run(cal.id)
        }
        ctx.events.onConflict({
          accountId: account.id,
          calendarId: cal.id,
          uid: op.uid,
          summary: op.summary,
          kind: op.kind,
          reason: 'attempts'
        })
        touched.add(cal.id)
      } else {
        ctx.db
          .prepare('UPDATE cal_pending_ops SET attempts = ?, last_error = ? WHERE id = ?')
          .run(attempts, message.slice(0, 500), op.id)
      }
    }
  }
  if (touched.size > 0) ctx.events.onChanged(account.id, [...touched])
  return pushed
}

// --- Schleife pro Konto ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 5 * 60_000
export const BACKOFF_BASE_MS = 15_000
export const BACKOFF_MAX_MS = 15 * 60_000

/** Backoff mit Jitter (±30 %), exponentiell bis zum Maximum. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
  return base * (0.7 + random() * 0.6)
}

export function pollDelay(random: () => number = Math.random): number {
  return POLL_INTERVAL_MS * (0.9 + random() * 0.2)
}

export type RunOutcome = 'ok' | 'needs-reauth' | 'error'

export interface LoopDeps {
  db: Database.Database
  events: SyncEvents
  onState: (accountId: number, state: CalSyncState, detail: string | null) => void
  /** Test-Hook: eigene fetch-Implementierung */
  fetch?: FetchLike
  getPassword?: (accountId: number) => string | null
}

/** Ein Konto: Poll-Schleife mit Backoff, needs-reauth bei 401. */
export class AccountLoop {
  private stopped = false
  private attempt = 0
  private needsReauth = false
  private wake: (() => void) | null = null
  private forceNext = false
  private running = false
  // Anstoß während eines laufenden Abgleichs: danach nicht erst das Intervall abwarten
  private kicked = false

  constructor(
    private readonly accountId: number,
    private readonly deps: LoopDeps
  ) {}

  start(): void {
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.wake?.()
    this.deps.onState(this.accountId, 'off', null)
  }

  /** Sofortiger Abgleich (UI-Refresh, lokale Änderung); weckt auch Backoff-Wartezeiten. */
  refreshNow(opts: { force?: boolean; clearReauth?: boolean } = {}): void {
    if (opts.force) this.forceNext = true
    if (opts.clearReauth) this.needsReauth = false
    if (this.needsReauth) return
    if (this.wake) this.wake()
    else this.kicked = true
  }

  /** Nach Systemruhe: aufwecken, aber needs-reauth nicht aufheben. */
  wakeUp(): void {
    if (!this.needsReauth) this.wake?.()
  }

  /** Ein Lauf ohne Wartezeit (auch für Tests). */
  async runOnce(): Promise<RunOutcome> {
    const { db } = this.deps
    const account = getCalAccount(db, this.accountId)
    if (!account) return 'error'
    const password = (this.deps.getPassword ?? ((id) => getSecret(calSecretKey(id))))(
      this.accountId
    )
    if (!password) {
      this.setState(account, 'needs-reauth', 'Kein Passwort im Vault')
      return 'needs-reauth'
    }
    const client = new DavClient({ username: account.username, password, fetch: this.deps.fetch })
    this.setState(account, 'syncing', null)
    this.running = true
    try {
      const force = this.forceNext
      this.forceNext = false
      await syncAccount({ db, client, events: this.deps.events }, account, { force })
      ensureInstanceWindow(db)
      db.prepare('UPDATE cal_accounts SET last_sync = ? WHERE id = ?').run(Date.now(), account.id)
      this.setState(account, 'idle', null)
      return 'ok'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof DavAuthError) {
        this.setState(account, 'needs-reauth', message)
        return 'needs-reauth'
      }
      console.warn(`[calendar:${account.name}] ${message}`)
      this.setState(account, 'error', message)
      return 'error'
    } finally {
      this.running = false
    }
  }

  private setState(account: CalAccountRow, state: CalSyncState, detail: string | null): void {
    this.deps.db
      .prepare('UPDATE cal_accounts SET state = ?, last_error = ? WHERE id = ?')
      .run(state, detail, account.id)
    this.deps.onState(account.id, state, detail)
  }

  isRunning(): boolean {
    return this.running
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      this.deps.onState(this.accountId, 'connecting', null)
      const outcome = await this.runOnce()
      if (this.stopped) break
      let delay: number | null
      if (outcome === 'ok') {
        this.attempt = 0
        delay = pollDelay()
      } else if (outcome === 'needs-reauth') {
        // Kein Backoff-Loop gegen falsche Zugangsdaten: warten, bis der Nutzer eingreift
        this.needsReauth = true
        this.attempt = 0
        delay = null
      } else {
        delay = backoffDelay(this.attempt)
        this.attempt += 1
      }
      if (this.kicked && delay !== null) {
        this.kicked = false
        continue
      }
      await new Promise<void>((resolve) => {
        const timer = delay === null ? null : setTimeout(resolve, delay)
        this.wake = () => {
          if (timer) clearTimeout(timer)
          resolve()
        }
      })
      this.wake = null
      this.needsReauth = false
    }
  }
}

// --- Engine -----------------------------------------------------------------------------------------

/** Verwaltet die Schleifen aller Kalender-Konten. */
export class CalendarSyncEngine {
  private db: Database.Database | null = null
  private loops = new Map<number, AccountLoop>()
  private states = new Map<number, { state: CalSyncState; detail: string | null }>()
  private errorSince = new Map<number, number>()
  private events: SyncEvents = { onChanged: () => {}, onConflict: () => {} }
  private stateListener: (accountId: number, state: CalSyncState, detail: string | null) => void =
    () => {}

  init(
    db: Database.Database,
    events: SyncEvents,
    onState: (accountId: number, state: CalSyncState, detail: string | null) => void
  ): void {
    this.db = db
    this.events = events
    this.stateListener = onState
  }

  startAll(): void {
    if (!this.db) return
    const rows = this.db.prepare('SELECT id FROM cal_accounts').all() as Array<{ id: number }>
    for (const { id } of rows) this.startAccount(id)
  }

  startAccount(accountId: number): void {
    if (!this.db || this.loops.has(accountId)) return
    const loop = new AccountLoop(accountId, {
      db: this.db,
      events: this.events,
      onState: (id, state, detail) => {
        this.states.set(id, { state, detail })
        if (state === 'error' || state === 'needs-reauth') {
          if (!this.errorSince.has(id)) this.errorSince.set(id, Date.now())
        } else if (state === 'idle' || state === 'off') {
          this.errorSince.delete(id)
        }
        this.stateListener(id, state, detail)
      }
    })
    this.loops.set(accountId, loop)
    loop.start()
  }

  stopAccount(accountId: number): void {
    this.loops.get(accountId)?.stop()
    this.loops.delete(accountId)
    this.states.delete(accountId)
    this.errorSince.delete(accountId)
  }

  stopAll(): void {
    for (const id of [...this.loops.keys()]) this.stopAccount(id)
  }

  /** Zugangsdaten geändert: Schleife neu starten (verlässt needs-reauth). */
  restartAccount(accountId: number): void {
    this.stopAccount(accountId)
    this.startAccount(accountId)
  }

  getState(accountId: number): {
    state: CalSyncState
    detail: string | null
    errorSince: number | null
  } {
    const known = this.states.get(accountId)
    return {
      state: known?.state ?? 'off',
      detail: known?.detail ?? null,
      errorSince: this.errorSince.get(accountId) ?? null
    }
  }

  /** Manueller Refresh (alle Konten oder eines); hebt needs-reauth auf (Nutzeraktion). */
  refresh(accountId?: number, force = false): void {
    const targets = accountId !== undefined ? [this.loops.get(accountId)] : [...this.loops.values()]
    for (const loop of targets) loop?.refreshNow({ force, clearReauth: true })
  }

  /** Nach lokaler Änderung: zeitnah übertragen. */
  kick(accountId: number): void {
    this.loops.get(accountId)?.refreshNow()
  }

  wakeAll(): void {
    for (const loop of this.loops.values()) loop.wakeUp()
  }
}

export const calendarSync = new CalendarSyncEngine()
