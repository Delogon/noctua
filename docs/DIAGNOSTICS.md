# Performance diagnostics

Noctua can measure where time and CPU go, so that "it gets slow with a big mailbox" turns into
numbers. Everything is measured and stored **on the device**. Nothing is uploaded. The user exports
a ZIP on request and decides whether to share it.

Settings → Tech → **12 · Performance diagnostics**.

## What is measured

| Layer              | What                                                                                                                                                                                       | Where                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| SQL                | every statement on the main connection: compile time, run/get/all time, rows, count. Keyed by **normalized SQL** (literals → `?`, `IN (?, ?, …)` → `?…`). Parameter values are never kept. | `src/main/diagnostics/db-profiler.ts` (wraps `db.prepare` / `db.exec`) |
| IPC                | handler time per channel (`ipc.<channel>`), errors per channel; renderer round-trip per channel                                                                                            | `src/main/ipc/register.ts`, `src/renderer/src/lib/ipc.ts`              |
| Push               | count per push channel (`push.<channel>`), `messages:changed` events and thread keys                                                                                                       | `register.ts`, `src/main/index.ts`                                     |
| Sync               | `sync.folder`, `sync.incremental.newMessages`, `sync.incremental.flags`, `sync.ingestBatch`, `sync.backfill.envelopeChunk`, `sync.bodies.pass/fetchChunk/fetchOne/store`, `mail.parse`     | `src/main/sync/account-syncer.ts`                                      |
| Contacts           | `db.contacts.rebuildStats`                                                                                                                                                                 | `account-syncer.ts`                                                    |
| AI                 | `ai.queue.discover`, `ai.job.triage`, `ai.job.events`, `ai.embed.batch` (inference round trip; the model runs in a worker thread), `ai.embed.ensureStates`, `ai.embed.cleanupOrphans`      | `src/main/ai/queue.ts`, `src/main/ai/embeddings.ts`                    |
| Thread list        | `db.threads.buildItems` (the per-thread follow-up queries after the aggregate)                                                                                                             | `src/main/db/repos/threads.ts`                                         |
| Database           | `db.optimize` (planner statistics: a full check a minute after startup, then every 6 h and on quit)                                                                                        | `src/main/db/optimize.ts`                                              |
| Startup            | `startup.cleanupForwardTasks`, `startup.reindexHtmlOnly`                                                                                                                                   | `src/main/index.ts`                                                    |
| Process (every 5s) | main CPU %, RSS/heap, **event-loop delay** p50/p99/max (a blocked main loop = a UI that waits), CPU and memory of all Electron processes (renderer, GPU), SQL/IPC load in the interval     | `src/main/diagnostics/sampler.ts`                                      |
| Renderer           | long tasks (> 50 ms on the UI thread = jank), JS heap                                                                                                                                      | `src/renderer/src/lib/diagnostics.ts`                                  |

Each timing keeps count, total, max and a fixed-bucket histogram (p50/p95/p99). Events ≥ 100 ms go to
a slow log (top 100). Extra data on events is numbers/booleans only (e.g. `{ messages: 200 }`), so no
string from a mail can end up in it.

Overhead: two `performance.now()` calls per SQL statement and a 5-second sampler. Diagnostics can be
switched off in the panel (`diagnostics.enabled`); then the wrappers fall through to the original calls.

## Benchmark

"Run benchmark" times the operations that scale with mailbox size against the real local database,
three runs each: thread list (inbox/sent/spam, 300 rows), mailbox counts, folder list, opening the
newest thread, search index status, lexical search with a fixed term, AI triage discovery and the
contact-statistics rebuild. Writing operations run inside a `SAVEPOINT` and are rolled back. For every
statement that ran, it records `EXPLAIN QUERY PLAN` and flags tables read without an index
(`SCAN x`), full index walks (`SCAN x USING INDEX i`, still O(n)) and temporary B-trees. The "statements" column shows N+1 patterns, for example a list that
runs 2,500 queries for 300 rows.

The benchmark blocks the main process while it runs, on purpose: those queries block it the same way
in daily use.

### Synthetic large mailbox (developers)

```bash
NOCTUA_PERF_MESSAGES=50000 pnpm test:perf
```

Seeds an encrypted, WAL-mode database on disk (as in the app) with threads, 2,000 senders, HTML
bodies and annotations. It then runs the same benchmark, plus a 500-UID flag pass like
`incrementalSync` and the refresh fan-out of one `messages:changed`. The JSON result goes to
`test/local/out/large-mailbox-<n>.json` (git-ignored).

## Export

"Export diagnostics (.zip)" asks where to save, optionally runs the benchmark first, and writes:

| File             | Content                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.txt`     | what is and is not inside                                                                                                                                                   |
| `manifest.json`  | app/Electron/Chrome/Node/SQLite versions, OS release, CPU model and count, RAM                                                                                              |
| `metrics.json`   | timings, SQL statistics, counters, slow log of this session                                                                                                                 |
| `samples.json`   | process time series (up to 1 h)                                                                                                                                             |
| `dataset.json`   | mailbox shape, counts only: messages, threads, bodies (+ total characters), folders per role, AI jobs, index state, DB size, indexes; accounts as "1, 2, …" + provider type |
| `benchmark.json` | benchmark cases and query plans                                                                                                                                             |
| `renderer.json`  | renderer IPC round-trips, long tasks                                                                                                                                        |
| `sessions/`      | the same measurements from up to 5 earlier app sessions (saved every 5 min and on quit to `userData/diagnostics/`, mode 0600)                                               |

**Never included:** subjects, senders, recipients, addresses, message text, attachments, search terms,
account names, file paths, host names, keys, passwords. A test (`test/diagnostics/profiler-benchmark.test.ts`)
seeds mails with marker strings and asserts that none of them appear anywhere in the export.

"Delete measurements" resets the in-memory data and removes `userData/diagnostics/`.

## Measured: synthetic mailbox, 5,000 vs. 20,000 messages

`pnpm test:perf`, encrypted WAL database on disk, Linux container (absolute times vary by machine;
the growth is what matters). Median of three runs.

| Operation                                            | 5,000    | 20,000        | SQL statements |
| ---------------------------------------------------- | -------- | ------------- | -------------- |
| `contacts.rebuildStats` (main thread, sync)          | 2,199 ms | **33,539 ms** | 4              |
| ingest per message (seeding, incl. threading)        | ~3 ms    | **~66 ms**    | –              |
| `threads.list.inbox(300)`                            | 389 ms   | 332 ms        | **~2,350**     |
| `threads.list.spam(300)` (tiny folder)               | 72 ms    | 185 ms        | ~2,300         |
| lexical search                                       | 112 ms   | 331 ms        | 4              |
| `threads.mboxCounts` / `folders.list`                | 8 / 7 ms | 67 / 49 ms    | 3 / 1          |
| one `messages:changed` refresh (list+counts+folders) | 231 ms   | 283 ms        | –              |

The contact-statistics rebuild and ingest grow quadratically and are the clearest culprits. The thread
list runs thousands of statements per refresh, and every `messages:changed` repeats that refresh.

## First findings (code review + query plans, synthetic data)

These are candidates for the large-mailbox slowdown, each tied to a metric above to confirm with
real data:

1. **Flag resync marks ~500 threads as changed on every sync** (`sync.incremental.flags`,
   `events.messagesChanged.threadKeys`). `incrementalSync` re-applies the flags of the newest 500
   UIDs on every IDLE event, the 5-minute watchdog and the 10-minute poll of each folder. The writes
   are not wrapped in a transaction, and `applyFlagUpdate` reports a change even when nothing
   changed, so every pass fires `messages:changed` with ~500 thread keys.
2. **`messages:changed` fan-out is not coalesced** (`push.messages:changed`). Each event kicks the AI
   queue and the embedding indexer, updates the badge, and makes the renderer refetch the thread list,
   counts and folders.
3. **The thread list scans every message and then runs ~8 queries per row**
   (`ipc.threads:list`, `db.threads.buildItems`, statements per run in the benchmark). The `GROUP BY
thread_key` aggregate reads all messages of all folders. `buildThreadItem` then runs follow-up
   queries and up to three `htmlToText` calls on full bodies for each of the 300 rows.
4. **Contact statistics rebuild is contacts × messages** (`db.contacts.rebuildStats`). The correlated
   `display_name` update cannot use `idx_msg_from_addr_lower`. It runs synchronously on the main
   thread after every Sent sync and every send.
5. **Body backfill**: one IMAP round trip per message, then parsing and several separate writes. Each
   50-message pass re-sorts the whole folder (`sync.bodies.*`, `mail.parse`).
6. **AI discovery and embedding scans** every 20 s / 60 s and on every `messages:changed`
   (`ai.queue.discover`, `ai.embed.ensureStates`). Embedding inference runs in the main process with
   no throttle (`ai.embed.batch`).
7. No `ANALYZE` / `PRAGMA optimize` is ever run (`dataset.json` → `db.hasStat1`), so the planner
   picks without statistics.
