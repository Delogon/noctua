# Changelog

Alle nennenswerten Änderungen an Noctua werden hier dokumentiert.
Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Added

- **Calendar view** (Phase 2.2): a new top-level view next to Inbox / Waiting / Tasks (⌘4, also in the ⌘K palette and the View menu). Week view by default (Monday start, 24 h, working hours 08–18 shaded, scrolled to 07:00, current-time line), switchable to day and month. All-day and multi-day events sit in a row above the grid and are placed by their calendar days; overlapping events share columns; the month grid shows as many entries as fit plus “+k more”.
  - **Create** by clicking or dragging an empty slot (quick popover: title, time, calendar; “More …” opens the full editor) or with `n` (next full hour).
  - **Editor sheet**: title, location, notes, all-day, start/end with time zone (shown only when it differs from the system zone), calendar (fixed for existing events), recurrence (daily / weekly on weekdays / monthly / yearly, interval, until / count — complex rules are kept untouched and shown read-only), reminder presets, busy / free, attendees read-only. Repeating events ask “Only this event / This and following / All events” before saving or deleting. Read-only calendars show everything without edit controls; unsynced changes carry a hatch + dot marker.
  - **Sidebar** with a month navigator and the calendar legend (visibility toggle, colour from a small palette). **Owl rail** gets a compact “Today” agenda (today + tomorrow); a click jumps to the event. Reminder notification clicks open the event.
  - Keys (calendar view only): `d` `w` `m` day / week / month, `t` today, `j` `k` or `←` `→` next / previous period, `n` new, `↵` open, `e` edit, `⌫` / `Del` delete, `Esc` close.

## [0.98.0] - 2026-07-26

### Added

- **Reply to someone other than the sender** (M97): the addresses in the reply row are now chips with an × — striking one removes it from the reply. Combined with the + button (M90), that covers the case the row could not express before: not answering the sender at all and writing to a different person instead, while the reply stays in its thread and keeps the `Re:` subject. Removals are per-thread and are dropped again on send or when another thread is opened; a ↺ button brings them back. In reply-all the CC entries can be struck the same way. With nothing left the row says so and the send button stays locked, so a reply can never go out addressed to nobody.

## [0.97.1] - 2026-07-26

### Fixed

- **The window no longer freezes while typing.** Three main-process paths ran unindexed full scans on every interaction. `better-sqlite3` is synchronous, so each one stalled the whole IPC channel — every keystroke, every list update, the macOS spinner. Measured against the real 42k-message mailbox with the shipped binaries:
  - *Recipient suggestions* matched contacts by display name with a correlated `EXISTS (SELECT … FROM messages …)` evaluated once per contact row — 3k contacts against 42k messages with no usable index, roughly 130M row probes. **15–90 seconds per call**, and the recipient field fires one call per 120ms of typing. The display name now lives on `contact_stats` itself (migration 023), so the query never leaves a 3k-row table: **5ms**.
  - *Search* recomputed the owl's index-coverage footer on every query — a full scan of the trigram index plus a per-row `EXISTS` against the vec0 table, which has no rowid index. **1.0–4.6 seconds per keystroke**, for a caption. The counts now go through the FTS `_docsize` shadow table and are cached for a minute.
  - *The embedding indexer* re-checked every message against the vec0 table every 60 seconds — **1.3–3.9 seconds**, even with the index complete and nothing to do. Vectors lost to a table rebuild are now detected once per session with two counting queries instead.
- Migration 023 also adds `idx_msg_from_addr_lower`, which the fuzzy-sender channel's sender inventory groups by. It backfills once on first launch (~10s on a 42k-message mailbox).
- **The packaged app no longer swallows the whole project directory.** `electron-builder` does not read `.gitignore`, and the `files` list only excluded a handful of named files — so everything sitting next to the app was packed into `app.asar`. With the agent worktrees under `.claude/` grown to 25 GB, the build came out at **7.6 GB instead of 563 MB**. `.claude`, `.codex-work`, `coverage`, `output`, `outputs`, `tmp`, `test` and `scripts` are now excluded explicitly.

### Changed

- **Recipient suggestions match the name they display.** The name search used to hit any From name an address had ever carried, so typing "tim" surfaced a mailing list whose visible name is "noreply-spamdigest via Volt Deutschland – Oldenburg Team" — because one of its 100+ messages had been posted by a Tim. Matching now runs against the contact's actual display name, and a real contact takes the freed slot.

## [0.97.0] - 2026-07-21

### Changed

- **Semantic search moves to multilingual-e5-base** (M96): on the 57-case gold set from the real mailbox, recall@1 rises 51% → 65% and MRR 0.61 → 0.70, together with a retuned fulltext fusion weight of 1.3 (rare exact matches were being diluted by the broad semantic candidate list). Migration 022 rebuilds the vec table for the new 768 dimensions and the indexer re-embeds in the background. Includes an env-gated A/B runner as a local test.

## [0.96.0] - 2026-07-21

### Added

- **Owl query expansion knows the mailbox's senders** (M95): asking "Nachricht von meiner Bank" failed because nothing links "Bank" to N26. The keyword-expansion prompt now includes a compact inventory of the mailbox's top senders (display names, deduped), so category questions ("meine Bank", "mein Hoster", "meine Versicherung") resolve to the senders that actually exist in this mailbox.

## [0.95.2] - 2026-07-21

### Fixed

- **HTML-only mails are fully searchable again** (found by the real-mailbox search evaluation): the trigram rebuild in migration 021 repopulated the index from plain text/snippet only, silently dropping the body text of 425 HTML-only mails. A one-time startup job re-runs the regular indexing path (which extracts text from HTML) for those messages. Also: search hit signals are deduplicated ("sender" could appear twice).

## [0.95.1] - 2026-07-20

### Fixed

- **Owl follow-up questions resolve pronouns** (follow-up to M92): "Kannst du mir alle Mails von ihm geben?" retrieved random threads because retrieval only saw the current question. The recent conversation turns are now folded into the retrieval text (keyword expansion, semantic channel, and the fuzzy sender channel), so "ihm" inherits the sender from the previous question. "Alle Mails von …" also widens the sender channel (14 threads, basket cap 16) so the answer can actually enumerate.

## [0.95.0] - 2026-07-20

### Added

- **Typo-tolerant sender search** (M92): asking the owl "letzte Mail von jens buetfisch" now finds "Bütefisch, Jens" even with a dropped letter — query terms are matched against every known sender (name words + address local-part) with a bounded edit distance, umlauts and ß folded like the index. Matched senders feed a dedicated recency-ordered channel into both the owl's retrieval basket (leading it) and the search result fusion (new "sender" signal). Generic mailbox words (info, service, newsletter, …) never identify a sender.

## [0.94.0] - 2026-07-20

### Changed

- **Search matches inside words and treats ß like ss** (M91): the full-text index moves to SQLite's trigram tokenizer — searching "Tafeln" now finds the German compound "Großflächentafeln", and "gross"/"groß" find each other (ß is folded to ss identically at index and query time; case and umlauts were already folded). Migration 021 rebuilds the index once on first launch (a few seconds). Trade-off: search terms now need at least three characters to hit the full-text path — shorter terms fall through to semantic search.

## [0.93.3] - 2026-07-20

### Fixed

- **Search no longer masks recent mail behind old thread messages**: results collapse to one hit per thread, and the representative used to be the bm25 winner — a long March forward could outrank and hide the mail from last Friday, making it look like search couldn't find it. The thread's position still comes from its best-ranked message, but the displayed hit (date, subject, excerpt) is now the newest message of the thread that matched the query.

## [0.93.2] - 2026-07-20

### Fixed

- **Traffic lights vertically centered on the masthead wordmark**: the macOS window buttons sat 10px too high next to the Noctua wordmark. Position derived from the measured wordmark box (center 30px, buttons 12px tall → y 24).

## [0.93.1] - 2026-07-20

### Changed

- **The add-recipients button in the reply row is easier to spot** (follow-up to M90): instead of a bare plus glyph it is now a framed square in the filter-trigger vocabulary — 1px ink border, paper background, offset shadow; ink-filled while open, accent-filled with a +N badge while extra recipients are set.

## [0.93.0] - 2026-07-20

### Added

- **Extra recipients when replying** (M90): The reply-to row now has a small + button that opens +TO/CC/BCC fields — with the same chip input and contact autocomplete as the composer. Added addresses merge into the computed reply set on send, deduplicated across fields (to beats cc beats bcc); the button shows a +N badge while extras are set, and they reset when switching threads or after sending.

## [0.92.1] - 2026-07-16

### Behoben

- **Cloud-Triage: abgeschnittene Antworten bei Reasoning-Modellen** (Fund aus dem DeepSeek-Benchmark): `max_tokens: 500` zählte bei Hybrid-Reasonern wie DeepSeek v4 Flash die Denk-Tokens mit — Antworten endeten mit `finish_reason: length` mitten im JSON und verbrannten Retries. Jetzt 1200 Tokens Budget (der eigentliche Output bleibt ~150). Außerdem kann das Eval-Harness jetzt gegen OpenRouter messen: `OPENROUTER_API_KEY=… node scripts/apple-triage-eval/run.mjs deepseek`. Ergebnis auf dem 24-Mail-Set: DeepSeek P 100 %/R 100 %, Kategorie 91 %, ~7 s/Mail, ~0,015 ct/Mail — die zweistufige Apple-Pipeline hält bei der Aufgaben-Precision mit (100 %), liegt bei Recall (90 %) und Kategorien (~74 %) darunter, ist dafür lokal, kostenlos und schneller (~2,8 s/Mail).

## [0.92.0] - 2026-07-16

### Geändert

- **Keine Aufgaben mehr aus historischen Mails** (M89): Beim Einrichten eines Postfachs holt der Erst-Sync bis zu 90 Tage Historie — daraus entstanden bisher rückwirkend Aufgaben und Vorschläge. Jetzt erzeugen nur noch Mails Aufgaben, die NACH der Konto-Einrichtung angekommen sind (Server-Ankunftszeit vs. Einrichtungszeitpunkt); Triage, Kategorien, Prioritäten und Zusammenfassungen laufen für die Historie unverändert. Gilt für beide Scan-Provider und für bestehende Konten ohne Verhaltensänderung.

## [0.91.0] - 2026-07-16

### Geändert

- **On-Device-Triage erkennt wieder Aufgaben — jetzt zweistufig und eval-getrieben** (M88): Statt der Abschaltung aus 0.90.1 stellt das Apple-Modell jetzt zuerst EINE enge Gate-Frage („Bittet ein Mensch den Kontoinhaber persönlich um etwas, gibt es eine echte Frist für ihn, oder wartet jemand auf seine Antwort?") und erst bei Ja dürfen action_items und Antwort-Erwartung Aufgaben erzeugen. Das kleine Modell beantwortet die isolierte Frage deutlich zuverlässiger, als es Aufgaben im Gesamturteil extrahiert: Auf einem neuen 24-Mail-Eval-Set (12 Fallen wie Newsletter-CTAs, Werbe-Fristen, Paket-Tracking, Verteiler-Mails; 10 echte Bitten; 2 Edge-Cases) steigt die Aufgaben-Precision von 64 % auf **100 %** bei 90 % Recall — dreifach gemessen, stabil. Kostet einen zweiten Modell-Aufruf (~2×1,4 s/Mail, Hintergrund-Queue). Das Eval-Harness liegt unter `scripts/apple-triage-eval/` (Gold-Labels + Runner) — Prompt-Änderungen dort nachmessen statt nach Gefühl texten; der DeepSeek-Vergleich lässt sich damit später ergänzen.

## [0.90.1] - 2026-07-16

### Geändert

- **On-Device-Triage leitet keine Aufgaben mehr ab** (Nachbesserung zu M87): Das kleine Apple-Intelligence-Modell erkannte deutlich zu viele Schein-Aufgaben (Handlungsaufforderungen aus Newslettern und Info-Mails). Beim Apple-Provider entstehen jetzt weder Action-Item- noch „Antworten:"-Aufgaben — Kategorie, Priorität, Zusammenfassung und die Antwort-Erwartungs-Markierung bleiben on-device erhalten. Die Options-Beschreibung in den Einstellungen sagt das jetzt dazu; mit OpenRouter als Scan-Provider funktioniert die Aufgaben-Erkennung unverändert.

## [0.90.0] - 2026-07-16

### Hinzugefügt

- **Triage wahlweise lokal über Apple Intelligence** (M87): In Einstellungen → Intelligenz lässt sich der Posteingang-Scan auf das On-Device-Modell von macOS 26 umstellen (Apple Silicon, Apple Intelligence aktiviert) — Kategorie, Priorität, Zusammenfassung, Aufgaben und Antwort-Erwartung entstehen dann komplett auf dem Gerät, der Mail-Text verlässt den Rechner nicht und es fallen keine API-Kosten an (Kostenzeile 0 $). Technik: ein kleiner Swift-Helper (`native/fm-helper`, Guided Generation garantiert das JSON-Schema) spricht mit dem Main-Prozess über ein Zeilenprotokoll; `pnpm dev`/`build:mac` bauen ihn automatisch mit, ohne Swift-Toolchain fehlt nur das Feature (Status wird in den Einstellungen erklärt: Modell lädt, Apple Intelligence aus, Helper fehlt). Lehnen Apples Guardrails einen Mail-Inhalt ab, entsteht ein neutrales Urteil (Kategorie „other", keine Aufgaben) statt eines hängenden Jobs; ist das Modell vorübergehend nicht bereit, bleibt der Job ohne verbrannten Versuch liegen. Diktat und Entwürfe laufen bewusst weiter über OpenRouter — es gibt keinen stillen Cloud-Fallback für die Triage.

## [0.89.0] - 2026-07-16

### Hinzugefügt

- **Freie Modellwahl mit Funktions-Test** (M86): Unter Einstellungen → Intelligenz lässt sich für Scannen und Schreiben jetzt jedes OpenRouter-Modell eintragen („eigenes Modell…"). Eine Annotation macht ehrlich, dass Kosten und Tauglichkeit dann beim Nutzer liegen — und der **TESTEN**-Knopf schickt eine Beispiel-Mail durch den Scanner-Prompt: Kommt strukturiertes JSON zurück, zeigt die Zeile ✓ mit Latenz und Kosten und erst dann den ÜBERNEHMEN-Knopf; sonst den konkreten Fehlergrund. Neuer IPC-Kanal `ai:testModel` (Contract-getestet), Antwort-Urteil als pure, unit-getestete Funktion.
- **Zero-Data-Retention-Routing, standardmäßig an** (M86): Alle OpenRouter-Anfragen (Scannen, Entwerfen, Eule-Chat, Stil-Training, Diktat, Regeln, Stupser) tragen jetzt `provider.data_collection = "deny"` — geroutet wird nur zu Anbietern, die Prompts nicht speichern. Der neue DATENSCHUTZ-Schalter in den Intelligenz-Einstellungen kann das abschalten, wenn ein Wunschmodell sonst nicht verfügbar ist; der Hinweis erklärt den Tausch.

## [0.88.6] - 2026-07-16

### Behoben

- **Ein Neustart mitten im Onboarding überspringt nicht mehr den Rest des Flows:** Sobald das erste Konto verbunden war, wertete der nächste App-Start es als „Bestandsinstallation" und markierte das Onboarding still als erledigt — wer z. B. nach dem ersten Konto neu startete (oder die App abstürzte), wurde nie nach dem OpenRouter-Schlüssel gefragt. Das Onboarding setzt jetzt ein `onboardingStarted`-Flag; beim Start entscheidet eine testbare Regel (`onboardingBootDecision`): abgeschlossen → nichts, unterbrochener Flow → fortsetzen (mit verbundenen Konten direkt bei Schritt 2), Konten ohne je gestarteten Flow → weiterhin still als onboarded markieren (echte Bestandsinstallationen).
- **Proton Bridge und exotische IMAP-Setups funktionieren jetzt im Onboarding:** Das Verbinden-Formular hardcodete Port 993 und riet den SMTP-Host per `imap.`→`smtp.` — die Bridge (127.0.0.1, Ports 1143/1025) konnte nie klappen, obwohl der Hinweistext sie erwähnte. Jetzt gibt es ein Port-Feld (leer = 993), und Loopback-Hosts bekommen automatisch die Bridge-Defaults (IMAP 1143, SMTP 1025 auf demselben Host). Das Passwort-Feld ist in eine eigene Zeile gerückt, damit Adresse und Host nicht mehr verwechselt werden.
- **Der Erst-Sync ist im Onboarding sichtbar:** Verbundene Konten zeigen während des Ladens einen pulsierenden Punkt mit **LÄDT MAILS · {n}** und live hochzählender Zahl (danach „✓ {n} Mails"), und neben WEITER erklärt ein Hinweis, dass Mails im Hintergrund weiterladen — man muss nicht warten.

### Geändert

- **„Mails" statt „Threads":** Der Jargon-Begriff ist aus Onboarding und Einstellungen verschwunden; `accounts:list` liefert dafür eine ehrliche `messageCount` (Mail-Zahl statt Unterhaltungs-Zahl, Contract-getestet).

## [0.88.5] - 2026-07-16

### Geändert

- **Onboarding: Das Verbinden-Formular klappt jetzt direkt unter dem gewählten Anbieter auf** statt gesammelt unter allen dreien — bei Google unter Google, bei Outlook unter Outlook, bei IMAP unter IMAP. So bleibt sichtbar, wofür man gerade Daten eingibt.
- **IMAP-Formular sagt „Passwort" statt „App-Passwort"** (Onboarding und Einstellungen → Konten): Bei generischem IMAP ist es ein normales Passwort — App-Passwörter waren die Gmail-Krücke, und Gmail läuft seit M46 über den Browser-Sign-in.

## [0.88.4] - 2026-07-16

### Behoben

- **Onboarding: Google Mail nutzt jetzt den Google-Sign-in** statt des alten App-Passwort-Formulars (QA-Fund im frisch installierten Build): „VERBINDEN" bei Google fragt nur noch den Postfachnamen und öffnet dann den Browser-OAuth — derselbe `accounts:addGoogle`-Kanal wie im Konten-Dialog der Einstellungen (M46). Der Hinweis erklärt, dass Noctua das Passwort nie sieht und kein App-Passwort mehr nötig ist. Das Inline-Formular mit Adresse/App-Passwort bleibt nur für IMAP; der tote `provider: 'gmail'`-Zweig im Onboarding-Connect ist entfernt.

## [0.88.3] - 2026-07-16

### Geändert

- **README auf Englisch**: komplette Übersetzung inklusive Header (Tagline „the owl sorts, you decide", Badge-Labels license/version) — größere Reichweite fürs öffentliche Repo. App-UI und Changelog bleiben deutsch.

## [0.88.2] - 2026-07-16

### Entfernt

- **Design-Handoff-Ordner** (`design_handoff_noctua_mail/`, `design_handoff_v2/`): die HTML-Mockups und Task-Listen aus den Claude-Design-Übergaben waren Arbeitsartefakte, keine Projektquelle — das Letterpress-Design lebt längst im Code. Der Quellen-Kommentar in strings.ts verweist nicht mehr auf den gelöschten Ordner.

## [0.88.1] - 2026-07-16

### Geändert

- **README-Header für GitHub**: zentriertes Eulen-Logo mit Tagline und Badges (CI-Status, Version aus package.json, Plattform, MIT-Lizenz) in den Farben des Letterpress-Themes. Die dynamischen Badges (CI, Version) rendern erst, sobald das Repo öffentlich ist.

## [0.88.0] - 2026-07-16

### Geändert

- **Open-Source-Vorbereitung** (M85): README neu geschrieben (ehrlicher Feature-Stand statt veralteter Meilensteine, die nie gebaute Signal-Sektion entfernt, Setup/Datenschutz/Grenzen dokumentiert), MIT-Lizenz ergänzt, `license`/`repository` in package.json, `.claude/`, `output/` und `.env*` in .gitignore. Persönliche Postfach-Referenzen sind aus Code, Tests und Changelog entfernt: Migration 011 leitet Kontonamen nur noch aus Domains ab, Test-Fixturen nutzen eine fiktive Persona, das Design-Handoff-Mock eine fiktive Adresse.

### Behoben

- **`pnpm dev` startet wieder echten Dev-Modus**: Die gebrandete Dev-Hülle (umbenannte Electron-Binary) ließ `app.isPackaged` fälschlich `true` melden — die App sperrte dadurch die Prod-Datenbank und lud den gebauten Renderer statt des Vite-Dev-Servers (deshalb zeigte die Dev-Instanz nach Merges veralteten Code). `scripts/dev.mjs` setzt jetzt `NOCTUA_DEV=1`, der Main-Prozess nutzt das als Dev-Signal (userData `noctua`, Vite-URL, Dev-Menüeinträge, kein Single-Instance-Lock). `pnpm start` (Preview) bleibt bewusst prod-nah.

## [0.87.2] - 2026-07-16

### Behoben

- **Offene Dropdowns erzeugen keinen seitlichen Scrollbalken mehr** (Nachbesserung zu M83): Das VON-Menü ragte über die Sheet-Kante und vergrößerte damit den Scroll-Container — der Composer ließ sich plötzlich zur Seite scrollen. Alle Filter- und Konto-Menüs liegen jetzt im Top-Layer des Fensters (native Popover-API, `popover="manual"`): Dort nehmen sie keinen Platz im Container ein, werden von keinem Vorfahren abgeschnitten und liegen über allem — die Ausrichtungslogik aus M83 bestimmt weiter die Position, neu auch bei Scroll. Öffnen, Schließen, Esc und Außenklick verhalten sich unverändert.

## [0.87.1] - 2026-07-16

### Behoben

- **VON-Menü im Composer öffnete nicht mehr** (Nachbesserung zu M83/0.86.0): Die automatische Popover-Ausrichtung ankerte am nächsten positionierten Vorfahren — dem VON-Control im Composer fehlte `position: relative`, also landete das Menü unsichtbar außerhalb des Sheets. Das Control hat jetzt den Positionierungskontext, und der Baustein `usePopoverPlacement` ankert robust am Eltern-Control statt am offsetParent — künftige Einsatzstellen können nicht mehr auf dieselbe Falle laufen. Postfach-, Aufgaben- und Posteingangs-Filter visuell gegengeprüft: unverändert korrekt.

## [0.87.0] - 2026-07-16

### Geändert

- **Der Antwort-Umfang ist jetzt ein echter Toggle in der Empfängerzeile** (Design Turn 9, ersetzt den Text-Umschalter aus 0.83.0): Rechts in der ANTWORT-AN-Zeile sitzt ein Toggle-Track im Rules-Muster (26×14, eckiger Knopf) mit Label **ALLEN ANTWORTEN** und **+n**-Vorschau der zusätzlichen Empfänger — aus: Knopf links, gedämpft; an: Track gefüllt, +n in Akzent. Die ganze Gruppe ist die Klickfläche (`aria-pressed`, ≥24px). Bei aktivem Umfang erscheint darunter eine eigene **CC-Zeile** (Label in Akzent, eine Zeile mit Ellipsis, vollständige Liste im Tooltip), und der Sendeknopf sagt die Konsequenz: **SENDEN AN {n}** statt ANTWORT SENDEN. Ohne weitere Empfänger wird der Toggle nicht gerendert.
- **⌘⇧A schaltet den Umfang im Editor um** — als neuer Composer-Shortcut neben ⌘↵/⌘D/⌘J/⌘⇧F, wirkungslos während Diktat/Formulieren/Senden und ohne weitere Empfänger. Die Tasten r/a bleiben unverändert die Listen-Shortcuts (ohne Editor-Fokus); das ?-Overlay erklärt beide Wege.

## [0.86.0] - 2026-07-16

### Behoben

- **Dropdowns erkennen jetzt die Fensterränder** (M83): Das Postfach-Menü der Liste ankerte starr rechtsbündig an seinem Trichter — saß der Trigger links in der Pane, ragte das 292 px breite Menü aus dem Fenster. Alle Filter-Popovers (Postfach, Aufgaben-Status, Posteingangs-Filter, VON-Wahl im Composer) messen sich jetzt beim Öffnen am Fenster und wählen die Richtung selbst: linksbündig, wenn rechts Platz ist, sonst rechtsbündig, notfalls an die Kante geklemmt; nach oben statt unten, wenn unterm Anker weniger Raum bleibt — reicht keine Seite, wird die Höhe gekappt und das Menü scrollt. Die Messung passiert vor dem Paint (kein Aufblitzen an falscher Position) und wiederholt sich bei Fenster-Resize. Der Baustein `usePopoverPlacement` steht künftigen Dropdowns zur Verfügung; die Geometrie ist als pure Funktion testbar.

## [0.85.0] - 2026-07-16

### Geändert

- **Die QUELLEN-Karte der Eule zeigt nur noch echte Belege** (M82): Bisher listete sie den kompletten Suchkorb — bis zu 12 Threads aus semantischer Suche, Volltext und den neuesten Mails —, auch wenn die Antwort nur zwei davon zitierte. Jetzt wird die Karte auf die im Text zitierten [n] gefiltert, die Kopfzeile sagt ehrlich „antwortete aus 2 Quellen", und der Rest des Suchkorbs erscheint nur als gedämpfte Zeile „+ 10 weitere Threads geprüft, in der Antwort nicht zitiert". Antworten ohne Zitate (auch ältere Gespräche) zeigen unverändert die volle Liste. Gezählt wird mit demselben Parser, der die [n]-Marker klickbar macht — Karte und Antwort können nicht auseinanderlaufen.

## [0.84.0] - 2026-07-16

### Geändert

- **Der Listen-Filter ist jetzt ein erweiterbares Menü** (Design Turn 7, ersetzt die Variante aus 0.80.0): Die FILTER-Zeile unter den Ordner-Tabs zeigt einen Trichter (gefüllt in Akzentrot, sobald ein Filter aktiv ist), daneben pro aktivem Filter einen Chip mit ×-Feld zum Einzelnen-Entfernen und rechts „zurücksetzen"; ohne Filter steht dort still ALLE. Das Trichter-Menü rendert Sektionen und Optionen aus einer Filter-Registry — künftige Filter sind ein Eintrag statt neuer UI. Heute: PRIORITÄT → „Alles zeigen" / „Braucht dich — Rang 4+" mit Zähler und I-Kürzel. Aktive Filter wirken nur im EINGANG (in GESENDET/SPAM verschwindet die Zeile, die Auswahl bleibt für die Rückkehr erhalten), Taste i schaltet weiter um, und mehrere aktive Filter verknüpfen sich als UND.

### Behoben

- **Filter-Popover ragten aus dem Fenster:** Beide Trichter-Menüs (Posteingang und Aufgaben) sind jetzt an ihrer Pane festgeklemmt — links bzw. rechts am Trichter verankert, nie breiter als die Spalte, nie höher als 60 % des Fensters (dann scrollt der Inhalt).

## [0.83.0] - 2026-07-16

### Hinzugefügt

- **„Allen antworten" ist zurück** (vor dem Letterpress-Redesign als Taste vorhanden, um 0.19 verloren): Taste **a** im Posteingang antwortet an alle — AN geht an den Absender der letzten fremden Nachricht, CC an deren übrige ursprüngliche An-/CC-Empfänger, automatisch bereinigt um die eigenen Adressen (alle Konten) und Duplikate. Über dem Antwort-Editor zeigt eine neue Empfänger-Zeile jederzeit, an wen die Antwort geht, mit sichtbarem Umschalter **ALLEN ANTWORTEN (A)** / **NUR ABSENDER (R)** — der Umschalter erscheint nur, wenn es überhaupt weitere Empfänger gibt; ohne weitere Empfänger erklärt ein Hinweis, dass die Antwort an den Absender geht. Das ?-Overlay listet die neue Taste.

### Behoben

- **Antworten respektieren jetzt den Reply-To-Header:** Bisher ging jede Antwort stur an die From-Adresse, obwohl das DETAILS-Panel abweichende Antwort-Adressen sogar anzeigt. Jetzt wird der Reply-To der Envelope beim Sync gespeichert (bestehende Nachrichten ziehen beim nächsten Envelope-Sync nach, bis dahin Fallback auf From) und sowohl **r** als auch **a** adressieren ihn.

## [0.82.0] - 2026-07-16

### Entfernt

- **Tote IPC-Kanäle ausgebaut** (QA-Pass 16.07.): `mail:unsubscribe` + `unsubscribe:candidates` (samt `src/main/mail/unsubscribe.ts`), `ai:retriage`, `tasks:completeAll`, `updates:check`, `secrets:delete`, `app:setBackgroundColor`, `app:ping` und `search:query` hatten keinen einzigen Renderer-Aufrufer mehr — Contract, Handler und zugehörige Main-Logik (`searchThreads`, `completeAllOpenTasks`, `retriageOutdated`) sind raus. Der periodische Update-Check (`updates:available`-Toast) bleibt unberührt.
- **Tote Push-Kanäle:** `auth:reauthRequired` wurde nie gesendet, `sync:progress` bei jedem Folder-Sync gesendet, aber nirgends abonniert — beide gestrichen, inklusive des Fortschritts-Plumbings im Sync (`onProgress` samt Coverage-Query).
- **Ungenutzte Renderer-Hooks:** `useSearch`, `useMessageAction`, `useAiUsage`, `useUpdateTask`, `useDismissFollowup`, `useThreadMessageIds` — alle ohne Konsumenten. `ai:usage` liefert nur noch, was die Oberfläche liest (`hasApiKey`, `triageModel`, `draftModel`); Kosten-/Job-Zähler zeigt keine View mehr an.
- **`stores/ui.ts` auf die zwei echten Slices eingedampft** (`overrideMenuOpen`, `addAccountOpen`) — der Rest war ein toter Parallel-Store zu `stores/paper.ts`; die `composerInit`-Guards in der Keymap sind mit raus.
- **`threads:list` ohne totes Plumbing:** Scope `flagged` und die Tab-Filterung (`matchesTab`, `InboxTab`) waren von keiner Ansicht mehr erreichbar — Vertrag und Repo-Query entsprechend verschlankt.
- **36 verwaiste i18n-Keys** aus `strings.ts` entfernt (per Skript gegen alle `t()`-Aufrufe und dynamischen Label-Maps verifiziert).

### Behoben

- **`ai:draftReply` verschluckte `reviseText`:** Der Vertrag erlaubte das Feld, der Handler reichte es aber nicht an `startDraftReply` weiter — Überarbeitungen eines bestehenden Entwurfs kamen ohne den Entwurfstext an. Jetzt durchgereicht, mit Regressionstest.

## [0.81.0] - 2026-07-16

### Geändert

- **Der Stups ist jetzt ein echter Composer** (WARTET-Ansicht): Der automatisch entworfene Nachfass streamt in dasselbe Editorfeld wie eine Antwort — danach ist alles editierbar: manuell tippen, **⌘D** diktiert in den bestehenden Text hinein, **⌘J/MIT EULE FORMULIEREN** formuliert den bearbeiteten Stand neu, Formatierung (**⌘⇧F**) inklusive. Gesendet wird weiter nur per **⌘↵** („STUPS SENDEN") — ein blankes Enter löst nie eine Mail aus; NICHT MEHR WARTEN (D) bleibt als eigene Aktion daneben.
- **Die Signatur des Kontos, das die ursprüngliche Mail gesendet hat, hängt jetzt am Stups:** Sie erscheint unter dem Editor (wie beim Antworten) und wird beim Versand über exakt denselben Pfad wie bei Antworten genau einmal angehängt. Der Entwurfs-Prompt erzeugt bei eingerichteter Signatur keine eigene Grußformel mehr — eine trotzdem erzeugte wird vor der Anzeige entfernt.
- **Bearbeitete Stupse überleben Threadwechsel und Neustart:** Manuelle Änderungen werden entprellt gespeichert — beim nächsten Öffnen liegt der bearbeitete Stand wieder im Composer. Der Stups fädelt sich beim Empfänger außerdem in den ursprünglichen Thread ein (In-Reply-To auf die eigene gesendete Mail).

## [0.80.0] - 2026-07-16

### Geändert

- **Postfach- und „Braucht dich"-Filter sehen jetzt aus wie der Aufgaben-Filter:** Eine gemeinsame Formensprache für alle Listen-Filter — Label · aktueller Wert · Trichter-Knopf, Optionen im aufklappbaren Kästchen (wie STATUS bei den Aufgaben). Der große Postfach-Dropdown ist durch die kompakte Kontrolle ersetzt (Konto-Farbmarke bleibt), und der „BRAUCHT DICH"-Chip ist unter die drei Ordner-Tabs gezogen: FILTER · ALLE/BRAUCHT DICH mit Trichter-Popover (ALLE vs. BRAUCHT DICH samt Zählern, Hinweis auf Taste i). Verhalten unverändert: Taste i schaltet um, Zähler zählt ungefiltert, bei 0 ist die Option deaktiviert.

## [0.79.0] - 2026-07-16

### Behoben

- **QA-Durchgang (Runtime-Sweep + drei Code-Audits) — die kleinen Befunde direkt behoben:** Das Gesendet-Echo bekommt jetzt auch den Zustand „wird gerade versendet" gemeldet (der Push für `sending` fehlte — die Zustandskette pending → sending → sent ist jetzt vollständig und getestet). Das ?-Tasten-Overlay listet endlich **⌘J (Idee → Mail)**. Zwei deutsche Hartkodierungen in der Signatur-Seite sind i18n-fähig (Bild-Fehlertoast, „Viele Grüße"-Fallback in der Vorschau). Ein veralteter Keymap-Kommentar (g-Sequenz) ist korrigiert. Größere Befunde (verlorenes „Allen antworten", toter IPC-/Store-Code) sind als separate Aufgaben erfasst.

## [0.78.0] - 2026-07-16

### Hinzugefügt

- **Die Eulen-Priorität ist jetzt sichtbar** (Design Turn 5): Zeilen mit Rang 5 tragen einen roten Tick am Zeilenanfang (klingelt), Rang 4 einen schwarzen (benachrichtigt) — mit Tooltip und Screenreader-Label; alles darunter bleibt bewusst still, keine Zahlen, keine Sortierungsänderung. Im geöffneten Thread zeigt ein Chip über dem Betreff DRINGEND (Rang 5) bzw. WICHTIG (Rang 4), und das DETAILS-Panel bekommt eine TRIAGE-Zeile: Kategorie, fünf Prioritätsbalken samt „PRIORITÄT n VON 5", „ERWARTET ANTWORT" — plus Hinweis, dass Rang 4+ benachrichtigt und 5 klingelt. Ohne Annotation erscheint nichts davon.
- **„BRAUCHT DICH"-Filter:** Neuer Chip rechts über der Liste (und Taste **i**) blendet alles außer Rang 4+ aus — als Sitzungsfilter, nichts wird persistiert. Der Zähler zählt immer die ungefilterte Liste, bei 0 ist der Chip deaktiviert statt versteckt, und der Leerzustand gratuliert: „Nichts braucht dich zuerst." Das ?-Overlay erklärt beide Tick-Farben in einer kleinen Legende.

## [0.77.0] - 2026-07-16

### Geändert

- **Der Aufgaben-Statusfilter ist jetzt frei kombinierbar:** Bisher war OFFEN fest angehakt — „nur Erledigte anzeigen" ging gar nicht. Jetzt sind OFFEN und ERLEDIGT gleichberechtigte Häkchen: beide an zeigt alles (ALLE), nur eines zeigt die jeweilige Sorte (OFFEN bzw. ERLEDIGT), und beide aus zeigt bewusst eine leere Liste (KEINE, mit Hinweis „Nichts eingeblendet."). Beim Umschalten rückt die Auswahl auf den nächsten sichtbaren Eintrag; Abhaken/Wiederöffnen einer Aufgabe wählt den sichtbaren Nachbarn, wenn sie dadurch aus der gefilterten Sicht verschwindet.

## [0.76.0] - 2026-07-16

### Behoben

- **Geöffnete Mails gelten jetzt als gelesen:** Der rote Ungelesen-Marker und die fette Absenderzeile blieben nach dem Anklicken einfach stehen — das Öffnen eines Threads hat Nachrichten nie als gelesen markiert (kein Aufrufer für markRead im Renderer). Jetzt werden beim expliziten Öffnen (Klick oder j/k) alle ungelesenen Nachrichten des Threads als gelesen markiert — lokal sofort, auf dem IMAP-Server über die Op-Queue. Der beim App-Start automatisch angezeigte oberste Thread bleibt bewusst ungelesen, bis man ihn wirklich auswählt.

## [0.75.0] - 2026-07-16

### Hinzugefügt

- **Follow-up-Schwelle einstellbar:** Unter Einstellungen → Intelligenz gibt es die neue Karte FOLLOW-UP-RADAR — nach wie vielen Tagen Stille eine unbeantwortete gesendete Mail unter WARTET auftaucht (3–21 Tage, Standard 3). Das Backend las `followup.waitDays` schon immer, nur die Tür fehlte; die Technik-Grafik 09 behauptete die Einstellbarkeit bereits und sagt jetzt die Wahrheit.

## [0.74.0] - 2026-07-16

### Behoben

- **Alle Zeitangaben in KI-Prompts laufen jetzt in Lokalzeit:** Chat-Kontext, Thread-Historie der Entwürfe und das Mail-Datum der Triage nutzten UTC (toISOString) — abends verschob das sogar das Datum, was Fristberechnungen („due relativ zum Mail-Datum") und „heute"-Fragen verfälschen konnte. Ein gemeinsamer Helfer (localStamp) formatiert jetzt überall in der Systemzeitzone.

## [0.73.0] - 2026-07-16

### Behoben

- **"Welche Mails kamen heute an?" findet jetzt die heutigen Mails:** Das Chat-Retrieval war rein thematisch (Vektor-Aehnlichkeit + Volltext) - bei Fragen mit Zeitbezug landeten thematisch aehnliche statt neuer Mails im Kontext. Jetzt laeuft ein Aktualitaets-Kanal mit: Die neuesten Threads (Eingang/Gesendet/Archiv aller Konten, kein Spam) sind immer Teil des Kontexts, bei erkennbarem Zeitbezug ("heute", "letzte Woche", "latest") stehen sie vorn. Kontextzeilen tragen Datum UND Uhrzeit; der veraltete Docstring ("bewusst ohne Embeddings") beschreibt jetzt das echte Hybrid-Retrieval.

## [0.72.0] - 2026-07-16

### Hinzugefügt

- **Einstellungen — „Wie die Eule denkt":** Eine neue Technik-Seite erklärt alle zehn KI-Pipelinen in kleinen Letterpress-Grafiken statt Text — Triage, Adressat-Erkennung (Anrede schlägt Umschlag schlägt Modell), das Aufgaben-Sieb mit seinen sechs Filtern in Code-Reihenfolge, die hybride Suche (FTS5 + lokale Embeddings, RRF-Fusion), „Die Eule fragen" mit [n]-Zitaten, Entwürfe & Stimme (Du/Sie deterministisch aus dem Verlauf, gesendet wird immer von Hand), die Hunspell-Rechtschreibprüfung ohne Cloud, Regeln (einmal entworfen, deterministisch angewandt), das Follow-up-Radar und die Datenhaltung (SQLite + Schlüsselbund-Vault; nach draußen reden nur Mailserver, OpenRouter und der anonyme GitHub-Update-Check). Ein Legenden-Streifen erklärt das Vokabular: durchgezogen = auf dem Gerät, gestrichelt = API-Call, ✦ = Sprachmodell. Jede Grafik ist gegen den Main-Prozess-Code verifiziert; alle Beschriftungen zweisprachig. Erreichbar über die Einstellungs-Liste („Technik") und die ⌘K-Palette („Wie die Eule denkt").

## [0.71.0] - 2026-07-16

### Hinzugefügt

- **Die Eule zeigt sich im UI (Design-Handoff Turn 4):** Eine neue `OwlGlyph`-Komponente zeichnet die Eule als Inline-SVG in fünf Posen — wach (blinzelt alle 8–14 s, nie zwei Eulen synchron), blinzelnd, schlafend, suchend (Augenlauf) und lauschend. Sie lebt an acht Stellen: im Rail-Header (Pose folgt dem Zustand: Diktat → lauscht, Entwurf → sucht, kein Schlüssel → schläft samt neuem Status „schläft — kein Schlüssel."), als schlafender Stempel in leeren Sheets, im Frag-dein-Postfach-Leerzustand (einzige Eule mit Akzent-Auge), am „antwortet…"-Label beim Streamen, an der schlafenden Frage-Zeile, am Schlüssel-Status der Intelligenz-Einstellungen (wacht beim Speichern auf), im Onboarding-Hero und in Toasts mit Eulen-Text (zwei Augen statt Quadrat; der Rec-Punkt des Countdowns hat Vorrang). Bei „Bewegung reduzieren" friert alles auf dem statischen Frame ein. Strichstärken und Augen-Geometrie kommen als Lookup aus den Design-Specimens.

## [0.70.0] - 2026-07-16

### Behoben

- **Zweites Diktat lieferte Modell-Prosa statt Transkript:** Wer kurz nacheinander zweimal einsprach, bekam gelegentlich „Ich kann leider keine Audioaufnahmen direkt hören …" ins Feld — bei schneller Wiederverwendung des Mikrofons liefert macOS den Audio-Track anfangs stummgeschaltet, die Aufnahme blieb still, und das Transkriptions-Modell antwortete ratlos. Drei Schutzschichten: Die Aufnahme startet erst, wenn der Track wirklich Audio liefert (unmute-Gate); stumme Aufnahmen werden vor dem API-Call erkannt und als „Nichts zu hören — bitte nochmal einsprechen" gemeldet (spart zudem die Anfrage); und das Transkriptions-Modell hat jetzt ein festes Protokoll für unverständliche Aufnahmen ([LEER] → leeres Transkript statt Prosa). Verifiziert per Fake-Mikrofon in einer isolierten Instanz: Mehrfach-Diktate liefern durchgängig valide Aufnahmen.

## [0.69.0] - 2026-07-16

### Hinzugefügt

- **Fragen und Suchanfragen lassen sich einsprechen:** Das Eingabefeld der Eule (Suchen & Fragen) und die ⌘K-Palette haben jetzt einen Mikrofon-Knopf (◉, oder ⌘D im Feld) — gleiche Aufnahme-Optik wie beim Diktieren im Composer: roter Punkt, Pegel, Timer. ↵ oder „Aufnahme stoppen" beendet die Aufnahme, das Transkript landet direkt im Feld (bestehender Text bleibt stehen, das Transkript wird angehängt); Esc verwirft. Transkribiert wird wie gehabt über das Diktat-Modell.

## [0.68.0] - 2026-07-16

### Behoben

- **Versand über die Proton Bridge funktioniert auch im SSL-Modus:** Die Bridge kann SMTP wahlweise als STARTTLS oder als „SSL" (implizites TLS) betreiben — am Port 1025 ist das nicht ablesbar, und Noctua entschied die Betriebsart bisher rein nach Port-Konvention (nur 465 = SSL). Auf Loopback-Hosts wird die Betriebsart jetzt am Server erkannt: Im STARTTLS-Modus schickt er sofort seine 220-Begrüßung, im SSL-Modus wartet er stumm auf den TLS-Handshake. Das Ergebnis wird gemerkt; nach einem Sendefehler (z. B. umkonfigurierte Bridge) wird neu erkannt. Öffentliche Server folgen unverändert der Port-Konvention.

## [0.67.0] - 2026-07-16

### Geändert

- **Neue Fragen an die Eule erscheinen oben statt unten:** Bisher wurde jede weitere Antwort unter die vorherige gehängt — wer oben fragte, musste unten lesen. Jetzt steht die neueste Frage samt Antwort direkt unter der Eingabezeile, ältere Runden rutschen nach unten, und die Ansicht springt beim Fragen automatisch nach oben zur neuen Antwort. Während die Eule streamt, bleibt die Scroll-Position in Ruhe — wer gerade in einer alten Antwort liest, wird nicht hochgerissen.

## [0.66.0] - 2026-07-16

### Behoben

- **Aufgaben nur, wenn ich gemeint bin — Adressat-Erkennung (M64):** Eine Verteiler-Mail „Plakate und Sponsor Info" mit Anrede „Hallo Jannik" erzeugte bisher die Aufgabe „Antworten: …", obwohl die eigene Adresse weder in An noch CC stand. Jetzt prüft ein dreistufiges Gate, ob der Kontoinhaber wirklich gemeint ist: **Envelope** (weder An noch CC = Verteiler/Bcc ⇒ hartes Nein; nur CC bleibt wie bisher ausgeschlossen), **Anrede** (nennt die erste Zeile ausschließlich fremde Namen ⇒ hartes Nein, auch bei An-Platzierung; nennt sie den Inhaber — case-/diakritik-tolerant gegen Anzeigename, Postfachname und Local-Part der Adresse — ⇒ Aufgabe, sogar via Verteiler) und **Modell** (neues Pflichtfeld `addressed_to_me` in der Triage v5; `false` stuft bei An-Platzierung auf einen Vorschlag herab, sonst nichts). Harte Neins unterdrücken Auto-Task UND Vorschlags-Streifen; der Auto-Anlegen-Schalter (M50) bleibt darüber. Bestehende Aufgaben werden nicht rückwirkend gelöscht; Alt-Annotationen ohne das neue Feld gelten als adressiert (Migration 020, Schema-Default). Politik gebündelt in `taskAddresseeVerdict` (`src/main/ai/addressee.ts`), gründlich unit- und integrationsgetestet (Triage mit gemocktem Modell).

- **Proton Bridge (und andere lokale/exotische IMAP-Server) lassen sich jetzt verbinden:** Das IMAP-Formular in den Einstellungen verdrahtete die Ports fest (993/587) und riet den SMTP-Host aus dem IMAP-Host — die Bridge lauscht aber auf 127.0.0.1:1143 (IMAP) und 1025 (SMTP), daher „connect ECONNREFUSED :993". Das Formular hat jetzt eigene Felder für IMAP-Port, SMTP-Host und SMTP-Port (leerer SMTP-Host wird wie bisher abgeleitet); der Hinweis nennt die Bridge-Ports. Zusätzlich akzeptieren IMAP und SMTP selbstsignierte Zertifikate — aber ausschließlich auf Loopback-Hosts (127.x.x.x/localhost/::1): Die Bridge bringt ein eigenes Zertifikat mit, der Verkehr verlässt den Rechner nicht, und für alle echten Server bleibt die Zertifikatsprüfung strikt an.

## [0.65.0] - 2026-07-16

### Hinzugefügt

- **„+ NEU" in der Gesprächsliste der Eule:** Neben GESPRÄCHE sitzt jetzt ein kleiner Knopf, der eine neue Frage startet — dasselbe wie der Shortcut **n**, nur klickbar. Bewusst als stille Mono-Marke in Akzentfarbe gehalten (kein Kasten wie die großen Ink-Buttons); der Tooltip verrät den Shortcut.

## [0.64.0] - 2026-07-16

### Behoben

- **Die Eule kennt jetzt das heutige Datum:** Fragen wie „Welche Rechnungen habe ich diesen Monat bekommen?" scheiterten bisher an „mir ist das heutige Datum nicht bekannt" — Sprachmodelle wissen ohne Hinweis nicht, welcher Tag ist. Alle System-Prompts (Chat-Antwort, Chat-Suchbegriffe, Antwort-/Neu-/Überarbeitungs-Entwürfe, Stupser) beginnen jetzt mit einer Datumszeile inklusive Wochentag, ISO-Datum und Uhrzeit — damit funktionieren „diesen Monat", „gestern" und Diktate wie „sag ihm, ich melde mich morgen". Die Triage brauchte das nicht: Sie rechnet Fristen korrekt relativ zum Datum der jeweiligen Mail.

## [0.63.0] - 2026-07-15

### Hinzugefügt

- **Konten — die drei fehlenden Zustände (M61, Design 3b):** Trennen verlangt jetzt einen Zweitklick — der erste verwandelt den Knopf in `YES, DISCONNECT / KEEP` samt Hinweis „entfernt das Konto + seinen lokalen Index"; Esc, Blur oder 5 s ohne Entscheidung entspannen wieder (Fenster-Logik pur in `account-states.ts`, unit-getestet). Der Browser-Login zeigt statt eines nackten „···" die Zeile `wartet auf die Browser-Anmeldung··· — schau in dein Browserfenster` mit einem CANCEL, der den OAuth-Roundtrip WIRKLICH abbricht: neuer Kanal `accounts:cancelOAuth` (zod + Contract-Test), Google über den eigenen Loopback-Abbruch, Microsoft über einen abbrechbaren msal-Loopback-Client (`auth/loopback.ts`); der eigene Abbruch räumt still auf, kein Fehler-Toast. Sync-Fehler zeigen den GESPEICHERTEN Fehlertext inline („connect ECONNREFUSED 127.0.0.1:993 — seit 11:42", Zeitpunkt aus dem neuen `errorSince`, das über Backoff-Zyklen stehen bleibt) plus `RETRY`, der gezielt nur dieses Konto weckt (`sync:trigger` nimmt jetzt optional eine accountId).
- **Voice-Card sagt die Wahrheit (M61, Design 3e):** Frische-Zeile `132 Antworten · heute gelernt` aus echten Metadaten (`ai.styleMeta.{id}`: Umfang des Antwort-Korpus + Lernzeitpunkt, beim Training gespeichert; Kalendertag-genaue Ableitung unit-getestet). Ein gescheitertes Nachlernen friert den Balken ein und sagt den ECHTEN Grund inline — `FEHLGESCHLAGEN — 401 User not found.` (Electron-Transport-Rauschen wird abgestreift), bei ok:false live geprüft: kein Schlüssel („Die Eule schläft…") oder kein Korpus; `NEU VERSUCHEN` trainiert nur dieses Konto nach. Nie wieder stumme 100 % (gleiche Semantik wie das Onboarding seit M53). Die Anweisungs-Textarea flusht beim Unmount — Sheet-Wechsel mitten im Tippen verliert nichts mehr.

### Geändert

- **Privacy-Default gedreht (M61, Design 3b):** Remote-Bilder sind jetzt standardmäßig BLOCKIERT, bis der Nutzer sie erlaubt — als Privacy-Einstellung beschriftet („Bilder aus dem Netz blocken, bis ich sie erlaube" / „Freigaben pro Absender merkt sich die Eule"). Nur der ungesetzte Default dreht: Wer den alten Schalter je bewusst gesetzt hat ('1'/'0'), behält seine Wahl; die Sender-Freigabeliste funktioniert unverändert.

## [0.61.0] - 2026-07-15

### Hinzugefügt

- **Kategorie-Override hat endlich eine Tür (M59, Design 3d):** Das Menü existierte und funktionierte — es war nur nirgends erreichbar. Jetzt öffnet `l` es auf dem selektierten Thread im Posteingang, das Hilfe-Overlay listet die Taste. Optik im Paletten-Vokabular: Overlay-Karte mit Akzent-Label SET CATEGORY, Serif-Betreffzeile, Zeilen mit Accent-Balken und kbd-Chips 1–7, `0` = „Let the owl decide again", Fußzeile `1–7 / 0 SET · ↑↓ CHOOSE · ESC CLOSE`. Neu dazu: ↑↓ wählt, ↵ setzt die Auswahl. Verhalten unverändert — die Korrektur überstimmt das Modell dauerhaft (`ai:overrideCategory`). Solange das Menü offen ist, besitzt es die Ziffern selbst (kein Kontofilter-Umschalten); die 1–7/0-Zuordnung und die ↑↓-Klemmlogik sind als pure Funktionen (`override-options.ts`) unit-getestet, die `l`-Bindung samt Typing-Guard im Keymap-Test.

### Geändert

- **Regeln sprechen jetzt Letterpress (M59, Design 3c):** Die letzte Alt-Theme-Insel (`RulesSection`) ist repatriiert. Beschreiben→Entwerfen-Fluss mit Paper-Input („describe it — the owl builds it deterministically", Placeholder aus dem Mock) und Ink-Taste `DRAFT — ↵`; der Entwurf zeigt die menschliche Beschreibung zuerst (Titel + Satz), das Regel-JSON steckt hinter der Disclosure `SHOW RULE JSON ▸`; darunter `ACTIVATE RULE` / `DISCARD`. Regel-Zeilen im Toggle-Track- und Listenzeilen-Vokabular, Treffer als Outline-Chip (`12×`), ×-Löschen. Alle Strings laufen durch strings.ts (EN aus dem Mock, DE behält die heutige Copy); Fehler beim Entwerfen erscheinen inline in Akzentfarbe, nicht als Toast.
- **Signatur-Baukasten: kuratierte Swatches statt OS-Farbwähler (M59, Design 3f):** Der Bild-Hintergrund wird über sechs Swatches gewählt — TRANSPARENT (Diagonalstreifen) · PAPIER · drei PASTELLE (Konto-Farbtöne) · TINTE. Bereits gespeicherte Fremdfarben bleiben gültig und erscheinen als zusätzlicher, ausgewählter Swatch, bis man umgreift.

- **Compose — sichtbare Identität & ehrliches Senden (Design 3a):** Der VON-Picker ersetzt das nackte `<select>` durch das Konto-Menü der Liste (Swatch · Kontoname · E-Mail · Hotkey-Chip, ✓ am aktiven Eintrag; Pfeiltasten und Ziffern im Menü). Wechselt die Konto-Automatik das Konto (bevorzugtes Postfach je Empfänger), sagt eine Akzent-Notiz für ~4 s Bescheid — eine manuelle Wahl gewinnt und unterdrückt sie. Zweifelhafte Adressen (@ ohne Punkt in der Domain) behalten jetzt ihren Chip, im Akzent mit erklärendem title; die Konto-Automatik befragt nur noch plausible Adressen. Ein dezenter OHNE-BETREFF-Hinweis steht neben den Send-Aktionen, solange der Betreff leer ist. Esc legt den Entwurf ab (Autosave seit M44) und kehrt mit Hinweis-Toast in den Posteingang zurück.
- **Masthead: NEUE MAIL ⌘N (Design 3f):** ruhiger NavItem-Eintrag zwischen SUCHEN und POSTEINGANG — dieselbe Aktion wie ⌘N im Ablage-Menü, kein Button-Kasten. (Bewusst weiterhin ohne EULE-Eintrag und ⌘5 — das bleibt wie in M56 entfernt, auch wenn der Mock den alten Stand zeigt.)

## [0.60.0] - 2026-07-15

### Behoben

- **Enter in der Eulen-Suche fragt wieder zuverlässig:** Ruhte der Mauszeiger zufällig über der Trefferliste, übernahm die Zeile unter dem Zeiger per Hover die Auswahl — ↵ öffnete dann kommentarlos diese Mail statt die getippte Frage zu stellen (bei Tim live mit echten Mails reproduziert). Hover ist jetzt reine Optik; die Auswahl wandert ausschließlich über ↑↓, Klicken funktioniert unverändert.

## [0.59.0] - 2026-07-15

### Behoben

- **Eulen-Antworten rendern jetzt Markdown:** Fett, Kursiv, Code, Listen, Zwischenüberschriften und [n]-Quellenverweise erscheinen formatiert statt als rohe Sternchen — die [n] im Text sind klickbar und springen wie die SOURCES-Karte zum Thread. Bewusst ohne neue Dependency: ein kleiner Parser für genau die Teilmenge, die die Modelle produzieren, gerendert als React-Elemente (kein HTML-Injection); unvollständige Marker bleiben während des Streamings einfach Klartext. Auch der ↳-Gist in der Gesprächsliste zeigt keine Markdown-Zeichen mehr.

## [0.58.0] - 2026-07-15

### Geändert

- **Ein Sucheinstieg statt zwei:** Im Masthead bleibt nur noch SUCHEN / — es führt zur Eulen-View mit fokussiertem Suchfeld und trägt dort die Aktiv-Unterstreichung. Der separate EULE-Eintrag und der ⌘5-Shortcut sind weg (auch im App-Menü); / und ⌘F bleiben die Wege zur Suche. Tims Feedback nach dem Design-Handoff: zwei Masthead-Einträge aufs selbe Ziel fühlten sich wie Redundanz an.

## [0.57.0] - 2026-07-15

### Hinzugefügt

- **Eine Toast-Queue — vier Varianten, ersetzt drei Systeme (M55, Design 1c):** Neuer Store `stores/toast.ts` mit genau einer sichtbaren Toast und den Regeln aus dem Mock: Priorität countdown > error > action > info; eine höherrangige Toast verdrängt die sichtbare, verdrängte Infos kehren zurück, solange sie jünger als 8 s sind; Infos leben 3,6 s, Action-Toasts exakt so lange wie ihr Angebot, Countdowns bis `until` (dann Auto-Swap auf ihren Info-Text), Fehler bis zum Schließen. Die reine Queue-Logik ist ohne Timer unit-getestet.
- **Eine Leiste für alles (`components/paper/Toast.tsx`):** Ink-Balken unten mittig (26 px, max. 70 %), 7-px-Akzentquadrat — beim Countdown als pulsierender Rec-Punkt samt 2-px-Schiene, auf der die Restzeit als Akzentfüllung leerläuft. Knöpfe mit Tasten-Chip (Z, ⌘Z) invertieren beim Hover auf Papier; Fehler tragen einen Akzentrahmen und melden sich als `role="alert"`, alles andere als `role="status"`.

### Geändert

- **Ablegen:** Der Toast zum Ablegen ist jetzt eine Action-Toast „Abgelegt." mit echtem RÜCKGÄNGIG-Knopf — Knopf und Taste z tun exakt dasselbe, und das Fenster kommt aus einer einzigen Quelle (`ARCHIVE_UNDO_WINDOW_MS`, 5 s, dieselbe Konstante wie `stageArchive`).
- **Rückgängig-Senden ist die Countdown-Variante:** „Geht in {n}s als {addr} raus" mit RÜCKGÄNGIG ⌘Z — die Taste ist NUR bei sichtbarem Countdown gebunden und bleibt beim Tippen das native Undo. Abbrechen räumt die Toast still ab (die Composer-Rückkehr ist das Feedback, M52-Restore); nach echtem Versand bestätigt „Gesendet als {addr}".
- **Versandfehler werden ehrlich:** `toast.error` mit ENTWURF ÖFFNEN (springt zum Thread und legt den gesicherten Entwurf zurück in den Antwort-Composer) und SCHLIESSEN. Bewusst kein RETRY wie im Mock — ein Wiederhol-IPC existiert nicht.
- **Update-Hinweis:** Statt des oberen Banners eine persistente Info-Toast mit HERUNTERLADEN (öffnet wie bisher die Release-Seite via `app:openExternal`) und SCHLIESSEN.
- `usePaper.toastNow` ist nur noch ein Shim auf `toast.info` — alle Aufrufer unverändert.

### Entfernt

- `PaperToast` (Overlays), `OutboxToast.tsx` und `UpdateBanner.tsx` samt ihrer verwaisten Strings — drei Toast-Systeme, eine Leiste.

## [0.56.0] - 2026-07-15

### Hinzugefügt

- **Owl-View — Suchen + Fragen in einem Eingabefeld (ersetzt die Chat-Ansicht, Design 2a/2b):** Die Ansicht hinter ⌘5 heißt jetzt EULE und beginnt mit einem Suchfeld am Blattkopf. Tippen liefert sofort kostenlose, lokale Live-Treffer (bestehende semantische Suche, 300 ms entprellt); ↑↓ wandert über Frage-Zeile und Treffer, ↵ auf einem Treffer springt in den richtigen Ordner zum Thread. Erst ↵ auf der Frage-Zeile gibt Tokens aus: Die Antwort streamt mit Block-Cursor, zitiert Quellen als [n]-Karte (ÖFFNEN → springt zum Thread) und Folgefragen laufen im selben Verlauf; n beginnt eine neue Frage.
- **Gespräche überleben den Neustart:** Neue Tabelle `owl_conversations` (Migration 019) samt IPC-Kanälen `owl:list/get/save/delete` (zod-validiert, contract-getestet). Die linke Spalte der Owl-View listet vergangene Gespräche mit Zeit und ↳-Gist (erster Satz der Antwort), j/k markiert, ↵ öffnet, × löscht. Gespeichert wird erst nach einer vollständigen Antwort — leere oder abgebrochene Fragen nie.
- **Ohne Schlüssel schläft nur die Eule:** Die Treffer bleiben voll nutzbar (lokal); die Frage-Zeile zeigt „Die Eule schläft — Schlüssel unter Intelligenz hinterlegen" und führt per Klick/↵ direkt zu Einstellungen → Intelligenz. Fehler beim Fragen erscheinen inline unterm Feld (nie als Toast), und die Frage wandert zurück ins Eingabefeld.

### Geändert

- **⌘K ist wieder eine reine Befehlspalette:** Mail-Routing, Suchsektion, Skeletons und Entprellung sind raus — sie öffnet sofort und filtert nur noch Befehle (`>` bleibt als bewusster Nur-Befehle-Modus). Der neue Brücken-Befehl „Suchen & die Eule fragen" und die Fußzeile „MAILSUCHE: / — BEI DER EULE" zeigen den Umzug; der Index-Status („DIE EULE INDEXIERT … MAILS · LOKAL") wohnt jetzt in der Fußzeile der Owl-View.
- **Masthead:** Der umrahmte Such-Knopf ist ersetzt durch ein schlichtes SEARCH-/-Element vor dem Posteingang (öffnet die Owl-View und fokussiert das Feld) und ein OWL-⌘5-Element zwischen Aufgaben und Einstellungen (navigiert nur; aktiv-Unterstreichung wenn die Ansicht offen ist).
- **/ und ⌘F führen zur Eule** (View + fokussiertes Feld) statt zur Palette; Esc leert erst das Suchfeld und kaskadiert dann wie gewohnt. Das Tastatur-Overlay dokumentiert den Split („/ — suchen & die Eule fragen", „⌘k — Befehle").

## [0.55.0] - 2026-07-15

### Hinzugefügt

- **Onboarding hat jetzt einen eigenen Schlüssel-Schritt (3 von 4, „Die Augen der Eule"):** Maskierte Eingabe für den OpenRouter-Schlüssel, gespeichert über denselben Keychain-Kanal wie das Intelligenz-Blatt. Enter im Feld speichert (statt weiterzublättern), Fehler erscheinen inline unter dem Feld statt als Toast, und der Hinweis-Link zu openrouter.ai/keys öffnet im System-Browser. Beim erneuten Durchlaufen mit vorhandenem Schlüssel ist der Status maskiert vorbefüllt und der CTA sofort aktiv.

### Geändert

- **Das Stil-Training im Onboarding (jetzt Schritt 4 von 4) sagt die Wahrheit:** Ohne Schlüssel pausiert es sichtbar — leere Spur, „PAUSIERT — KEIN SCHLÜSSEL" und ein Callout, dessen Schlüssel-Knopf zurück zu Schritt 3 mit fokussiertem Feld führt — statt falsche Fortschritte anzuzeigen. Scheitert das Training eines Kontos trotz Schlüssel, zeigt die Zeile „FEHLGESCHLAGEN — NEU VERSUCHEN" mit echtem Retry nur für dieses Konto; still auf 100 % springt nichts mehr. Mail geht in beiden Fällen trotzdem weiter — der Einstiegs-CTA bleibt aktiv.
- **Übersprungenes Training holt sich die Eule selbst zurück:** Wird der Schlüssel später im Intelligenz-Blatt gespeichert, startet das Stil-Training automatisch für jedes Konto, das noch kein Profil hat.

## [0.54.0] - 2026-07-15

### Geändert

- **Stups senden verlangt jetzt ⌘↵:** Ein unfokussiertes Enter in der Wartet-Ansicht konnte eine echte Mail auslösen — jetzt sendet nur noch ⌘↵ (Button zeigt das Kürzel, Tastatur-Overlay ist angepasst).
- **Antworten archivieren erst, wenn die Mail wirklich draußen ist:** Bisher wurde der Thread sofort beim Einreihen archiviert — „Rückgängig" stoppte zwar den Versand, ließ den Thread aber archiviert und öffnete den leeren Composer. Jetzt wird der Thread während des Rückgängig-Fensters nur ausgeblendet; Rückgängig holt ihn samt Entwurf zurück in den Antwort-Composer, und archiviert wird erst nach erfolgreichem Versand (bei Versandfehler kommt der Thread ebenfalls zurück).
- **„HEUTE GESTUPST" überlebt jetzt Ansichtswechsel und Neustart:** Der Gestupst-Status wird am Followup gespeichert (Migration 018) statt nur im Fenster-Zustand; die Wartet-Liste zeigt gestupste Einträge mit Chip.
- **Englisch ist wieder vollständig englisch:** Chat, Undo-Send-Toast, Update-Banner, Konto-Dialog, Kategorie-Menü und der Remote-Bilder-Hinweis hatten fest verdrahtetes Deutsch — alles läuft jetzt über die Sprachtabelle.
- **Tastatur-Overlay sagt die Wahrheit:** ⌘D ist überall das kanonische Diktier-Kürzel (v als Alias erwähnt), ↵ heißt „Diktat abschließen", ⌘↵ hat eine eigene „senden"-Zeile, und das tote „g s"-Badge in der Palette ist weg. Der Lösch-Toast bleibt so lange sichtbar wie das Undo-Fenster (5 s).
- **Leere Mittelflächen zeigen einen ruhigen Leerzustand** statt einer leeren Fläche (Posteingang/Wartet/Aufgaben, gleiche Texte wie in der Liste).

### Behoben

- **Tastatur-Bedienung:** Alle klickbaren Beschriftungen (Eulen-Leiste, Aufgaben-Strip, Onboarding, Aufgaben-Blatt, KEIN-SPAM) sind jetzt echte Buttons — fokussierbar, mit sichtbarem Fokusring und per Enter/Space auslösbar; Abhak-Kästchen melden ihren Zustand an Screenreader. Kleine Ziele (× am Entwurf, X am Aufgaben-Vorschlag) haben unsichtbar vergrößerte Trefferflächen.

## [0.53.0] - 2026-07-15

### Hinzugefügt

- **Manueller Refresh:** Der neue ↻-Knopf neben den Ordner-Tabs (und der ⌘K-Befehl „Jetzt nach neuen Mails suchen") gleicht alle Konten sofort mit dem Server ab. Der Posteingang kommt per IDLE ohnehin live — der Refresh existiert für die Ordner am 10-Minuten-Poll, allen voran Spam (bei Hotmail landet dort einiges). Getrennte Verbindungen werden dabei sofort neu aufgebaut statt den Backoff abzuwarten; `sync:trigger` löst jetzt echte Ordner-Syncs aus, nicht mehr nur das Aufwecken.

## [0.52.0] - 2026-07-15

### Hinzugefügt

- **Automatische Aufgaben-Erstellung abschaltbar:** Unter Einstellungen → Intelligenz gibt es die neue Karte „AUFGABEN AUS MAILS" mit dem Schalter „Aufgaben automatisch anlegen". Ausgeschaltet legt die Eule nichts mehr von selbst an — Mails mit gefundenen Aufgaben zeigen stattdessen den Vorschlags-Streifen „DIE EULE FAND EINE AUFGABE", und erst T ÜBERNEHMEN macht daraus eine Aufgabe. Bereits angelegte Aufgaben bleiben beim Umschalten unberührt.

## [0.51.0] - 2026-07-15

### Hinzugefügt

- **Sync-Zeitraum pro Postfach einstellbar:** Beim Verbinden eines Kontos (Dialog und Einstellungen, alle drei Wege: Google, Microsoft, IMAP) lässt sich jetzt wählen, wie weit zurück Mails vom Server geladen werden — letzte 30/90 Tage, letztes Jahr oder alles; Standard bleibt wie bisher 90 Tage (Suche: 6 Monate). Unter Einstellungen → Konten ist der Zeitraum jederzeit änderbar: Vergrößern lädt ältere Mails im Hintergrund nach, Verkleinern löscht nichts Bestehendes.

## [0.50.0] - 2026-07-15

### Behoben

- **Rechtschreib-Tooltip verschwindet nicht mehr beim Ansteuern:** Wer mit der Maus vom unterstrichenen Wort in die Vorschlagsliste fuhr, sah sie nach einem Wimpernschlag zuklappen — der letzte Mauszug über den Editor traf kein Wort mehr, und dessen nachlaufender Treffer-Test plante das Ausblenden, nachdem der Zeiger den Tooltip schon erreicht hatte. Solange der Zeiger über der Liste steht, bleibt sie jetzt offen; Verlassen schließt sie weiterhin.

## [0.49.0] - 2026-07-15

### Entfernt

- **g-Sequenz (g + i/w/t/s) ist weg:** Der Zwei-Tasten-Shortcut funktionierte nicht zuverlässig und war ohnehin redundant — alle Ziele sind über ⌘1/⌘2/⌘3, ⌘, und die ⌘K-Palette erreichbar. Der Hinweis ist aus der Fußleiste und dem ?-Tastatur-Overlay entfernt, der zugehörige Code komplett ausgebaut.

## [0.48.2] - 2026-07-15

### Geändert

- **Doppelt verbinden wird klar geblockt:** Wer sich per Google oder Microsoft mit einer Adresse anmeldet, die schon verbunden ist, bekam bisher „Verbunden als …" gemeldet, obwohl kein neues Postfach entstand (und der Google-Weg stellte das Konto still auf OAuth um). Jetzt kommt eine klare Fehlermeldung samt Namen des bestehenden Postfachs — wer ein App-Passwort-Konto auf den Google-Login umstellen will, trennt es zuerst und verbindet es neu. Ein dabei bereits gespeichertes Google-Refresh-Token wird wieder aufgeräumt.

## [0.48.1] - 2026-07-15

### Behoben

- **Google-Login legte kein Konto an:** Die Browser-Anmeldung lief durch („Angemeldet."), aber in der App erschien kein Konto — ein CHECK-Constraint der accounts-Tabelle kannte den neuen Anmeldetyp `oauth-google` nicht und ließ den Eintrag im letzten Schritt platzen. Migration 016 baut die Tabelle mit erweitertem Constraint neu auf; der Migrations-Runner läuft dabei jetzt grundsätzlich mit deaktivierten Fremdschlüsseln plus Integritätsprüfung je Migration (sonst hätte der Neubau per ON DELETE CASCADE sämtliche Ordner und Mails mitgelöscht). Außerdem stellt der Google-Login eine bereits verbundene Adresse jetzt vom App-Passwort auf OAuth um, statt still nichts zu tun.

## [0.48.0] - 2026-07-15

### Hinzugefügt

- **Echter Google-Login statt App-Passwort:** Gmail-Konten verbinden sich jetzt wie Microsoft-Konten über den System-Browser (OAuth mit PKCE) — Postfachname eingeben, „Mit Google anmelden", im Browser zustimmen, fertig. Noctua sieht das Passwort nie; gespeichert wird nur das Refresh-Token, verschlüsselt im Vault (macOS-Keychain-gestützt), IMAP und SMTP sprechen XOAUTH2. Der Standard-Client ist Thunderbirds öffentlich dokumentierter Google-Client und lässt sich über die Settings `google.clientId`/`google.clientSecret` durch eine eigene Registrierung ersetzen. Beim Trennen des Kontos wird auch das Refresh-Token gelöscht; wird der Zugriff bei Google widerrufen, meldet der Sync „bitte Konto neu verbinden". Bestehende Gmail-Konten mit App-Passwort laufen unverändert weiter, und über „@ IMAP" bleibt der Passwort-Weg für Spezialfälle offen.

## [0.47.0] - 2026-07-15

### Behoben

- **Erneutes Öffnen nach geschlossenem Fenster stürzt nicht mehr ab:** Wer das Noctua-Fenster schloss (App läuft auf macOS weiter) und die App dann erneut in Programme/Dock startete, bekam „A JavaScript error occurred — Object has been destroyed" statt eines Fensters: Der Zweitstart-Handler fasste das zerstörte Fenster an. Jetzt öffnet der zweite Start in dem Fall einfach ein neues Fenster.

## [0.46.0] - 2026-07-15

### Behoben

- **Die verpackte App startet wieder mit Fenster:** Seit der semantischen Suche (0.37.0) scheiterte der Start der installierten App still — SQLite versuchte, die sqlite-vec-Erweiterung per nativem dlopen direkt aus dem asar-Archiv zu laden, was macOS nicht kann (Electrons asar-Umleitung greift nur für JS/fs, nicht für natives dlopen). Die App hing dann fensterlos im Dock. Der Extension-Pfad zeigt jetzt auf `app.asar.unpacked`; im Dev-Modus ändert sich nichts.
- **Startfehler zeigen jetzt einen Dialog statt einer unsichtbaren App:** Wirft die Startsequenz künftig eine Ausnahme, erscheint „Noctua kann nicht starten" mit der Fehlermeldung und die App beendet sich — statt als fensterloser Dock-Eintrag zu enden.

## [0.45.0] - 2026-07-15

### Geändert

- **Die verpackte App nutzt ein eigenes Datenverzeichnis (`noctua-prod`):** Bisher hätte eine installierte Noctua.app dieselbe Datenbank wie die Dev-Instanz geöffnet (macOS ignoriert Groß-/Kleinschreibung, „Noctua" und „noctua" sind derselbe Ordner) — zwei Instanzen auf einer DB bedeuten Lock-Konflikte und doppelten IMAP-Sync. Die Production-App startet jetzt mit eigenem Datenbestand und eigenem Safe-Storage-Schlüssel; Konten werden dort einmalig neu verbunden.

## [0.44.0] - 2026-07-15

### Geändert

- **Ein Klick auf eine Mail wechselt jetzt auch aus dem Composer zur Mail:** Bisher blieb die Ansicht im Editor hängen. Das Angefangene geht dabei nicht verloren: Empfänger (inkl. CC/BCC), Betreff und Text werden automatisch als Entwurf gesichert (überlebt auch einen Neustart) und liegen beim nächsten ⌘N wieder im Composer — mit Hinweis „Entwurf wiederhergestellt". „ENTWURF VERWERFEN" löscht den Entwurf endgültig; Esc verlässt den Composer und behält ihn.

### Behoben

- **„Rückgängig" beim Senden bringt den Entwurf wirklich zurück in den Composer:** Bisher stoppte der Abbruch die Mail zwar, der Text verschwand aber aus der Oberfläche (der alte Wiederöffnen-Pfad lief ins Leere). Jetzt öffnet sich der Composer wieder mit dem vollständigen Entwurf; bei abgebrochenen Antworten bleibt die Thread-Zuordnung beim erneuten Senden erhalten.

## [0.43.0] - 2026-07-15

### Geändert

- **Rechtschreibprüfung in den neuen Composer portiert:** Die Hunspell-Prüfung (0.40.0) läuft jetzt im Rich-Text-Composer — Wellenlinien kommen über die CSS Custom Highlight API direkt ins contentEditable (kein Overlay; die Markierungen wandern beim Tippen mit und funktionieren über Fett/Kursiv/Links hinweg). Hover zeigt Vorschläge, Klick ersetzt das Wort im Editor, IGNORIEREN gilt weiter pro Session; die native macOS-Prüfung des Editors ist dafür aus. Gilt für neue Mails und Antworten. Live verifiziert: „Terminvorschalg → Terminvorschlag" per Hover-Klick, „wich**tig**es" (fett gemischt) bleibt korrekt unmarkiert.

### Entfernt

- **Alte Editor-Überreste:** Die Textarea-basierte `SpellTextarea` (Mirror-Overlay) samt Hilfsfunktionen und Styles ist gelöscht — der alte Plain-Text-Editor existiert seit dem Composer-Umbau (0.37.0) nicht mehr.

## [0.41.0] - 2026-07-15

### Behoben

- **Zeilenumbrüche überleben jetzt den Versand:** Wurde ein KI-Entwurf, ein Diktat oder ein wiederhergestellter Entwurf im Composer nachbearbeitet, ging die Mail als HTML ohne Zeilenstruktur raus — beim Empfänger und in der Gesendet-Ansicht klebte alles in einem Absatz, während der Composer selbst die Umbrüche korrekt anzeigte. Ursache: Reiner Text landete als roher Textknoten im Editor, und beim ersten Edit wurde dessen HTML (ohne Zeilen-Tags) zur Versand-Alternative. Text wird jetzt beim Befüllen des Editors in echte Zeilen-Blöcke umgewandelt; zusätzlich wandelt der Versand tagloses „HTML" als letzte Sicherung selbst um (Antworten und neue Mails).

### Bekannt

- **Rechtschreibprüfung (0.40.0) im neuen Composer noch nicht angeschlossen:** Die Hunspell-Infrastruktur (Main-Prozess, IPC, Wörterbücher, SpellTextarea-Komponente) bleibt vollständig erhalten, aber der in 0.37.0 neu aufgebaute Rich-Text-Composer (contentEditable) nutzt sie noch nicht — die Wellenlinien-Anzeige war an das alte Textfeld gebunden. Bis zur Portierung greift die native macOS-Prüfung des Editors.

## [0.40.0] - 2026-07-15

### Hinzugefügt

- **Rechtschreibprüfung im Editor (Deutsch + Englisch):** Falsch geschriebene Wörter bekommen im Compose-Body und im Antwort-Editor eine rote Wellenlinie; Hover zeigt bis zu drei Korrekturvorschläge, Klick ersetzt das Wort, IGNORIEREN gilt für die Session (Eigennamen). Geprüft wird mit echtem Hunspell (WASM, igerman98 + SCOWL) im Main-Prozess — der native macOS-Spellchecker schied aus (erkennt bei Einzelwort-Prüfung Fehler wie „teh" nicht), nspell ebenso (beherrscht deutsche Komposita nicht: „Terminvorschlag" würde markiert). Ein Wort gilt als korrekt, sobald eine der beiden Sprachen es akzeptiert; URLs, Mail-Adressen und das Wort am Cursor werden nicht geprüft. Live verifiziert: „Terminvorschalg → Terminvorschlag" per Hover-Klick korrigiert, Komposita bleiben unmarkiert.

## [0.39.0] - 2026-07-15

### Hinzugefügt

- **Gesendete Mails erscheinen sofort unter GESENDET:** Direkt nach dem Senden zeigt die Liste die Mail als Platzhalter mit „WIRD GESENDET…" — durch das Rückgängig-Fenster und den Versand hindurch, bis die Server-Kopie zurückgesynct ist und den Platzhalter ersetzt (spätestens nach 90 s räumt er sich selbst auf). Rückgängig (z) entfernt ihn wieder; schlägt der Versand fehl, zeigt die Zeile kurz „NICHT GESENDET". Gilt für neue Mails, Antworten und Stupser.

## [0.38.0] - 2026-07-15

### Behoben

- **Die Eulen-Leiste zeigt jetzt alle Entwürfe, nicht nur maximal einen:** Entwürfe lebten bisher nur im Arbeitsspeicher — es gab app-weit genau einen, und jeder Threadwechsel oder ein ⌘D auf einem anderen Thread verwarf den vorherigen stillschweigend. Entwürfe werden jetzt je Thread gespeichert (entprellt beim Tippen und Diktieren, sofort beim Threadwechsel), überleben den Neustart und erscheinen alle unter „ENTWÜRFE FÜR DICH" (die jüngsten fünf, der Rest als Zähler). Beim Öffnen eines Threads mit gespeichertem Entwurf liegt dieser wieder im Composer, und der DRAFT-READY-Chip in der Liste kennt gespeicherte Entwürfe ebenfalls.

### Hinzugefügt

- **Entwürfe lassen sich in der Eulen-Leiste verwerfen:** Jeder Entwurf unter „ENTWÜRFE FÜR DICH" trägt ein **×** — ein Klick löscht ihn endgültig („Entwurf verworfen"). Senden, ESC VERWERFEN im Composer und das bewusste Leeren des Textes räumen den gespeicherten Entwurf ebenfalls auf.

## [0.37.0] - 2026-07-15

### Hinzugefügt

- **Semantische Mailsuche in der ⌘K-Palette:** Die Palette findet Mails jetzt auch nach Bedeutung statt nur nach exaktem Wortlaut — formuliere eine Frage in natürlicher Sprache („wann kommt das paket"), und die KORRESPONDENZ-Sektion zeigt passende Threads, auch wenn kein Wort wörtlich in der Mail steht. Volltext- und Bedeutungstreffer werden zu einer Rangliste verschmolzen; jeder Treffer trägt ein Label (KLARER TREFFER / MÖGLICH) samt Beleg-Ausschnitt. Die Suche greift über Eingang, Gesendet und Archiv (Spam und Papierkorb bleiben außen vor) und findet Mails auch über Anhang-Dateinamen. Die Fußzeile zeigt den Indexstand; ist das lokale Suchmodell noch nicht bereit, läuft die Volltextsuche unsichtbar als Rückfall weiter. Alles lokal — keine Mail-Inhalte verlassen den Rechner. Ein führendes `>` erzwingt den reinen Befehlsmodus der Palette.
- **Formatierter Composer:** Neue Formatierungsleiste (⌘⇧F) mit Fett, Kursiv, Unterstrichen, drei Schriftgrößen und Link-Einfügen. Formatierte Mails gehen als HTML raus, eine reine Text-Fassung bleibt für einfache Clients erhalten; eingefügter Text landet bewusst als Klartext. Außerdem neu: ein eigenes **BCC**-Feld („+ BCC"), dessen Adressen auch beim Abbrechen/Wiederöffnen erhalten bleiben.
- **Anhang-Liste unter empfangenen Mails:** Mit Dateityp-Erkennung (PDF, Bild, Tabelle, …), Größenangaben und „Speichern"-Knopf pro Datei. Inline-Bilder und technische MIME-Teile (z. B. PGP-Signaturen) werden nicht mehr fälschlich als Anhang gelistet.
- **Signatur-Bild feinjustierbar:** Position (links/oben/unten), Rahmen, Innenabstand und Hintergrundfarbe im Signatur-Baukasten; Vorschau und versendetes Bild nutzen exakt dieselbe Berechnung, das Bild wird beim Versand fest gerendert, damit Dark-Mode-Clients es nicht umfärben.
- **Postfach-Namen:** Jedes Konto hat einen eindeutigen, umbenennbaren Namen (Einstellungen → „Postfachname"), der überall auftaucht — Filter-Chips, Listen-Badges, Palette und Stil-Notiz. Die Zifferntasten **1–9** filtern im Eingang direkt auf das jeweilige Postfach, **0** zeigt wieder alle.
- **Technische Mail-Kopfdaten auf Klick:** Der neue **DETAILS**-Schalter über der Mail zeigt vollständige Header, Zustellungs-Authentifizierung (SPF/DKIM/DMARC), einen Hinweis bei abweichender Antwort-Adresse und die rohen Header. Wird erst beim Aufklappen nachgeladen und bleibt lokal.

### Geändert

- **Signatur landet genau einmal in der Mail:** Beim Versand wird die konfigurierte Signatur sauber angehängt und eine vom Modell erzeugte doppelte Grußformel am Textende entfernt. KI-Entwürfe enden jetzt generell nach dem letzten inhaltlichen Satz, wenn eine Signatur hinterlegt ist.
- **Neue Mails erkennen Diktat vs. Idee selbst:** Die Eule unterscheidet automatisch, ob du eine fertige Mail diktiert hast (Wortlaut bleibt, nur geglättet — „✓ DIKTAT LEICHT GEGLÄTTET") oder eine Idee beschreibst (wird ausformuliert — „✓ AUS DEINER IDEE FORMULIERT").
- **Keine Aufgaben und Stupser aus eigenen oder nur weitergeleiteten Mails:** Selbst verfasste Mails (auch Konto A → eigenes Konto B) und reine FYI-Weiterleitungen ohne Auftrag erzeugen keine Aufgaben und keine „KEINE ANTWORT BISHER"-Einträge mehr; bereits falsch angelegte werden bereinigt.
- **Empfänger-Vorschläge lernen aus gesendeten Mails:** Adressaten versendeter Nachrichten tauchen sofort in den Vorschlägen auf.
- **„ENTWÜRFE FÜR DICH" reagiert früher:** Die Eulen-Leiste zeigt den Entwurf, sobald Text vorliegt (nicht erst bei fertigem Status), und „ANSEHEN" springt zuverlässig zum Thread.
- **Dev-App ist gebrandet:** `pnpm dev` läuft als „Noctua" mit eigenem Icon in Dock und Menüleiste statt als „Electron".

## [0.36.0] - 2026-07-13

### Geändert

- **Du/Sie folgt dem Verlauf mit der Person — nicht dem Postfach-Profil:** Wirst du in einer Mail gesiezt oder hast du die Person früher gesiezt, siezt auch der Entwurf — egal was der generelle Ton des Postfachs sagt. Die Erkennung ist deterministisch (eigene frühere Mails an den Kontakt haben Vorrang, dann dessen Mails an dich; Zitat-Historie zählt nicht, satzinitiales „Sie" auch nicht, im Zweifel gewinnt das förmliche Sie) und gilt für Antworten und Stupser. Live verifiziert: Antwort auf einen siezenden Stadt-Oldenburg-Thread siezt trotz Du-Profil.

### Behoben

- **Keine doppelte Signatur mehr in Antwort-Entwürfen:** Der Antwort-Prompt war der einzige ohne die Anweisung, keine Signatur zu erzeugen — das Modell übernahm sie gelegentlich aus den Stilbeispielen, und beim Senden kam deine Signatur nochmal obendrauf.

## [0.35.0] - 2026-07-13

### Geändert

- **v überarbeitet bestehende Entwürfe statt sie zu verwerfen:** Liegt für den Thread schon eine vorformulierte Antwort bereit, startet v eine Überarbeitung — der rote Hinweis „ÜBERARBEITUNG — DEIN ENTWURF BLEIBT" erscheint im Diktat-Streifen, und was du diktierst (oder tippst) wird als Änderungswunsch in den bestehenden Text eingearbeitet; alles Übrige bleibt wortgleich erhalten. Esc oder ein leeres Diktat bringen den unveränderten Entwurf zurück. Live gegen die echte API verifiziert.

## [0.34.0] - 2026-07-13

### Hinzugefügt

- **Mail-Suche ist zurück** (beim Letterpress-Redesign verloren gegangen): Die ⌘K-Palette durchsucht ab zwei Zeichen den Volltext-Index (Betreff, Absender, Inhalt) über alle Konten und Ordner und zeigt Treffer als KORRESPONDENZ-Sektion unter den Kommandos — Enter öffnet den Thread. Neuer Shortcut **/** öffnet die Palette direkt (steht auch im ?-Overlay).

### Behoben

- **Suchtreffer öffnen den richtigen Thread:** Threads außerhalb der aktuellen Liste (z. B. aus GESENDET oder dem Archiv) zeigten stillschweigend den obersten Posteingangs-Thread an. Das Mail-Blatt zeigt solche Threads jetzt direkt über ihre Nachrichten an — das repariert auch den Klick auf Benachrichtigungen zu bereits archivierten Mails.

## [0.33.0] - 2026-07-13

### Behoben

- **Spam-Ordner wird jetzt wirklich synchronisiert:** Junk-Ordner standen seit jeher auf einem Sync-Modus, den die Engine komplett übersprang — der SPAM-Ordner zeigte deshalb immer 0, obwohl auf dem Server Spam lag. Junk wird jetzt voll gesynct (Envelopes + 10-Minuten-Poll); bestehende Konten heilen sich beim nächsten Verbinden selbst. Spam bleibt von Triage, Aufgaben, Chat-Index und Dock-Badge ausgeschlossen — er kostet keine AI-Anfragen.

### Geändert

- **„e ablegen" heißt jetzt „e löschen":** Fußzeile, Tastatur-Overlay und Rückgängig-Toast sprechen jetzt von Löschen statt Ablegen. (Technisch verschiebt e die Mail weiterhin ins Archiv des Kontos — sie ist also über die Websuche des Anbieters auffindbar, nur nicht mehr in Noctua.)

## [0.32.0] - 2026-07-13

### Behoben

- **Leertaste hakt Aufgaben jetzt wirklich ab:** Der Status wechselte zwar in der Datenbank, aber keine der Bedienstellen (Leertaste im Aufgaben-Blatt, Checkbox in der Liste, Erledigen in der Eulen-Leiste) aktualisierte die Anzeige — es sah aus, als passiere nichts. Jetzt meldet der Hauptprozess jede Aufgaben-Änderung per `tasks:changed`-Push an die Oberfläche; damit ist der Haken überall sofort sichtbar, egal von wo die Änderung kommt.

### Geändert

- **Keine Aufgaben mehr aus Mails, in denen du nur im CC stehst:** Steht deine Konto-Adresse nur im CC (nicht im An), richtet sich die Bitte an den Adressaten — solche Mails erzeugen keine Aufgaben und keine Vorschläge mehr. Mails direkt an dich sowie Verteiler-Zustellungen bleiben unverändert. Bereits angelegte Aufgaben bleiben bestehen.

## [0.31.0] - 2026-07-13

### Hinzugefügt

- **Ordner-Filter (aus dem Design-Projekt):** Über der Korrespondenz-Liste sitzt eine Segment-Leiste EINGANG · GESENDET · SPAM mit Live-Zählern. Gesendete Threads zeigen „An: <Empfänger>" statt des Absenders. In GESENDET und SPAM erscheint über der Mail ein Hinweis-Streifen; Diktat und Ablegen sind dort bewusst aus. Spam-Threads haben einen Knopf „KEIN SPAM → EINGANG", der die Mail zurück in den Posteingang verschiebt. Die Palette kennt die drei Ordner als Kommandos.
- **Signatur-Baukasten (aus dem Design-Projekt):** Neue Einstellungs-Karte „Signatur" — pro Adresse eine Signatur aus Bausteinen (Name, Titel, Firma, Telefon, Website, Anschrift, Claim, Trennlinie, Bild). Bausteine per Klick an/aus, Reihenfolge per Pfeilen, Texte direkt in der Anordnung editieren; die Vorschau zeigt das Ergebnis mit deiner gelernten Grußformel. Ein Bild (Kreis/abgerundet/eckig) lässt sich per Klick oder Drag&Drop setzen — mit Bild geht die Mail als HTML mit eingebettetem Bild raus, ohne Bild wie bisher als reiner Text. Palette: „Signatur bearbeiten".

## [0.30.1] - 2026-07-07

### Behoben

- **„NEU LERNEN" endgültig repariert:** Nach dem response_format-Fix (0.29.0) blockierte noch das Validierungs-Schema — es lehnte Profile ab, wenn das Modell z. B. mehr als 6 Anreden lieferte. Das Schema kappt und kürzt LLM-Antworten jetzt, statt sie abzulehnen. Live gegen die echte API verifiziert. Dev-Trigger `NOCTUA_TEST_STYLE=<accountId>` bleibt für künftige Diagnosen.

## [0.30.0] - 2026-07-07

### Geändert

- **Feste Schreibregeln für alle Entwürfe:** Antworten, neue Mails und Stupser verwenden keine Spiegelstrich-Aufzählungen, keine Gedankenstriche und keine Semikolons mehr — es wird in vollständigen Sätzen und normalen Absätzen geschrieben.

### Hinzugefügt

- **Stil-Probe:** In jeder Stil-Karte generiert der neue „PROBE"-Button eine Beispielantwort auf eine feste Testmail — mit exakt dem aktuellen Setup (gelerntes Profil + deine Regeln). So siehst du sofort, wie die Eule für diese Adresse klingt.

## [0.29.0] - 2026-07-07

### Behoben

- **„NEU LERNEN" funktioniert wieder:** Die Stil-Analyse schickte `response_format: json_object` an das Anthropic-Schreibmodell — das lehnt OpenRouter ab. Jetzt kommt das JSON per Instruktion und wird tolerant extrahiert (bekannte Lektion, war im Chat schon gefixt).

### Hinzugefügt

- **Eigene Stilregeln pro Adresse:** In jeder Stil-Karte (Einstellungen → Stil) gibt es ein Freitextfeld „DEINE REGELN FÜR DIESE ADRESSE" (z. B. „immer Du-Form, kurze Sätze, Gruß ‚Viele Grüße, Tim'"). Die Regeln fließen zusätzlich zum gelernten Profil in alle Entwürfe dieser Adresse ein — Antworten, neue Mails und Stupser — und haben Vorrang. Speichert beim Verlassen des Felds.

## [0.28.0] - 2026-07-07

### Hinzugefügt

- **Leisten-Toggles im Masthead:** Zwei Panel-Icons (rechts neben ⌘K) blenden die Korrespondenz-Liste links und die Eulen-Rail rechts einzeln ein und aus — der Zustand wird gemerkt. Mehr Platz fürs Lesen, wenn du ihn brauchst.

## [0.27.0] - 2026-07-07

### Geändert

- **Stups-Entwürfe werden gecacht:** Einmal entworfen, landet der Stups in der Datenbank (Migration 010) und erscheint beim nächsten Öffnen sofort — statt jedes Mal neu (und kostenpflichtig) generiert zu werden. „⟳ NEU ENTWERFEN" holt bewusst eine frische Fassung und überschreibt den Cache.

## [0.26.0] - 2026-07-07

### Behoben

- **Leertaste hakt sichtbar ab:** Der Task-Toggle aktualisierte die Liste nicht (Query-Invalidierung fehlte nach dem direkten Aufruf) — jetzt springen Liste, Sheet und Owl-Rail sofort um.

### Geändert

- **Aufgaben-Quelle zeigt die ganze Mail:** Im Task-Sheet steht unter QUELLE jetzt die vollständige Ursprungs-Mail (Absender, Zeit, Inhalt, einklappbares Zitat) statt nur des Betreffs; „O THREAD ÖFFNEN" springt weiterhin in den Posteingang.

## [0.25.0] - 2026-07-07

### Hinzugefügt

- **⌘J im Antwort-Editor:** Auch beim manuellen Antworten (r) kannst du jetzt Stichpunkte tippen und mit ⌘J (oder dem „IDEE → MAIL"-Button) von der Eule ausformulieren lassen — Label „AUS DEINEN STICHPUNKTEN ENTWORFEN". ⇧R (neuer Wurf) nutzt bei getipptem Text ebenfalls deine Stichpunkte als Grundlage.

## [0.24.0] - 2026-07-07

### Entfernt

- **Signal-Integration komplett ausgebaut** (auf Wunsch): signal-cli-Daemon/Link-Flow, Gruppen-Ansicht und -Dialog, alle `signal:*`-IPC-Kanäle, ⌘6-Menüeintrag und Palette-Kommando. Migration 009 löscht die Signal-Tabellen samt Daten. Bereits aus Signal erzeugte Aufgaben bleiben erhalten (Quelle wird weiter angezeigt). Das brew-Paket `signal-cli` kann deinstalliert werden (`brew uninstall signal-cli`); der Socket in Application Support verschwindet beim nächsten Aufräumen.

## [0.23.0] - 2026-07-07

### Geändert

- **Neueste Nachricht zuerst:** Im Thread steht die jüngste Mail oben, direkt darunter der Composer; der ältere Verlauf folgt darunter. Die geschwungenen Pfeile zeigen nach oben und tragen den **zeitlichen Abstand** zwischen den Nachrichten („1 Std.", „4 T. 5 Std.").
- **Mail-Breite gezähmt:** Der Mail-Body ist auf 680 px begrenzt und zentriert (wie in gängigen Clients) — Newsletter-Bilder wachsen nicht mehr auf Sheet-Breite; Bilder behalten ihr Seitenverhältnis (height auto), und `overflow-x-hidden` verhindert, dass breite Layouts über den Karten-Rand ragen.

## [0.22.0] - 2026-07-07

### Hinzugefügt

- **Konto-Farben:** Die Konto-Badges (Buchstaben-Quadrate) tragen jetzt die Farbe des Kontos — neue Konten bekommen zufällig eine Pastellfarbe, und unter Einstellungen → Konten sitzt pro Adresse ein Pastell-Picker (10 papierfreundliche Töne). Schriftfarbe und Rand passen sich automatisch an (Kontrast).

### Behoben

- **Keine Zombie-Instanzen mehr:** `scripts/dev.sh` (bzw. `pnpm dev:fresh`) beendet vor dem Start zuverlässig alle Projekt-Instanzen (electron-vite, Electron-Binärdatei auch im pnpm-`.pnpm`-Layout, verwaiste Renderer-Ports). Drei parallel laufende Instanzen hatten sich zuvor DB und IMAP-Verbindungen geteilt („Command failed"-Sync-Fehler). Die installierte App bekommt zusätzlich einen Single-Instance-Lock: ein zweiter Start fokussiert das bestehende Fenster.

## [0.21.0] - 2026-07-07

### Hinzugefügt

- **Thread-Ansicht in Boxen:** Jede Nachricht steckt in einer eigenen Karte (neueste betont mit Ink-Rahmen), verbunden durch einen geschwungenen Antwort-Pfeil. Die **Zitat-Historie** („Am … schrieb …:", „On … wrote:", >-Blöcke, gmail_quote/blockquote) wird pro Nachricht abgetrennt und ist per „früheren Verlauf anzeigen" einklappbar — lange Ping-Pong-Threads bleiben lesbar.
- **Compose als eigene Seite (⌘N):** ersetzt das Overlay. Feldzeilen AN/CC/BETREFF mit Empfänger-Chips und Autocomplete, VON-Wahl, Serif-Body, Diktat (v — Aufnahme→Transkription) und ⌘J Idee→Mail mit Betreff-Vorschlag, Regie-Feld, Esc zurück. Hinweis: Das claude.ai/design-Projekt war ohne interaktives Login nicht abrufbar (DesignSync/403) — die Seite folgt dem Letterpress-System; Abgleich, sobald die Datei vorliegt.

### Behoben

- **Login-/Sicherheits-Mails erzeugen keine Aufgaben mehr** („Neue Anmeldung bei Spotify" u. ä.): Triage-Prompt v4 verbietet action_items aus Security-/Verifizierungs-Benachrichtigungen; ein deterministischer Guard filtert zusätzlich beim Anlegen UND bei der Vorschlags-Anzeige (wirkt auch auf Alt-Annotationen).

## [0.20.0] - 2026-07-07

### Hinzugefügt

- **Echtes Diktat:** v nimmt jetzt wirklich auf (ein Mikrofon-Stream für Waveform + Aufnahme), ↵ transkribiert über das neue Diktat-Modell (`ai:transcribe`, OpenRouter-Audio-Chat, WAV PCM16 mono 16 kHz) und die Eule entwirft aus dem Transkript. Getippter Text im Diktat-Feld (z. B. via macOS-Diktat) hat weiter Vorrang.
- **Einstellungen → Intelligenz → MODELL — DIKTAT:** audiofähige Modelle live aus dem OpenRouter-Katalog (Default `openai/gpt-audio-mini`). Hinweis: `openai/whisper-large-v3` listet OpenRouter derzeit nicht — sobald es auftaucht, erscheint es automatisch in der Auswahl.
- **Bilder in Mails laden standardmäßig** (`mail.remoteImagesDefault`, Toggle in Einstellungen → Konten; aus = bisherige Sender-Freigabeliste mit Tracking-Schutz). Unverschlüsselte http-Bilder blockiert die CSP weiterhin.
- cid-Inline-Bilder (eingebettete Anhänge) werden im Lese-Sheet wieder aufgelöst.

### Geändert

- Masthead ohne „SCHREIBT ALS …" — das Absender-Konto ergibt sich aus der Auswahl.

## [0.19.0] - 2026-07-07

### Geändert

- **Komplettes Redesign nach Design-Handoff „Letterpress"** (`design_handoff_noctua_mail/`): Papier & Tinte statt Aurora & Glas — Newsreader + IBM Plex Mono (lokal gebundlet), Radius 0 überall, 1px-Ink-Borders, Offset-Schatten, Doppellinien. Layout: Masthead (Wortmarke · Datum · SCHREIBT ALS · Konto-Chips · Nav mit Zählern) + Liste (400px) + Sheet + Owl-Rail (290px). Das alte Design (Aurora, Glass-Dock, Vendor-Komponenten, Dark Mode) ist vollständig entfernt.

### Hinzugefügt

- **Wartet-View (⌘2):** Follow-up-Radar als eigene Ansicht — „N T. still", SILENCE-Callout, Stups wird live im Stil des Kontos gestreamt (`followups:draftNudge`), ↵ sendet, d verwirft.
- **Diktat-Composer im Sheet:** v = Zuhören (Ink-Strip, echte Mikrofon-Waveform mit Fallback, macOS-Diktat-Feld), ↵ → Eule entwirft (idle→listening→drafting→ready), e bearbeitet, ⇧R neuer Wurf, ESC verwirft; Senden archiviert den Thread und meldet „Gesendet als …".
- **Aufgaben-Vorschlags-Flow:** „DIE EULE FAND EINE AUFGABE"-Strip mit T ÜBERNEHMEN / X (`tasks:decideSuggestion`); TASK-Chips in der Liste; ✓-IN-DEINEN-AUFGABEN-Zustand.
- **Owl-Rail:** Entwürfe für dich (↵ ANSEHEN), Aufgaben aus Mails, Keine Antwort bisher (STUPS-Buttons), Dein Stil — alle live.
- **Onboarding (3 Schritte)** mit echten Konten-Flows (Microsoft-OAuth, Gmail-App-Passwort, IMAP) und echtem Stil-Training pro Adresse.
- **Einstellungen neu:** Konten (Provider-Glyphen, Thread-Zahlen, Trennen, Hinzufügen inkl. Inline-IMAP-Formular) · Stil (eine Stimme pro Adresse, Trait-Chips, NEU LERNEN mit Balken, learn-Toggle) · Intelligenz (Schlüssel-Karte, **Live-Modelllisten von OpenRouter** statt hartkodierter IDs, Square-Radios, Preis-Tags; NL-Regeln hier eingezogen).
- **i18n:** eine UI, zwei Sprachen — Deutsch (Standard) und Englisch, umschaltbar über die Palette; DE-Prototyp ist die autoritative Übersetzung.
- **Tastatur nach Spec:** j/k, v, e (bearbeitet offenen Entwurf), ↵-Präzedenz, r, ⇧R, t/x, ⇧S, z (Ablegen-Undo mit 5s-Fenster), g+i/w/t/s/e, 1/2/3-Kontofilter, ⌘1/2/3, ⌘K, ⌘,, Esc-Kaskade; g-Hinweis im Key-Strip.
- **Stil-Profile pro Konto** (`ai.styleProfile.<id>`), Drafts/Stupser nutzen das Profil des sendenden Kontos.
- Konto-Kurzlabels weichen bei Namenskollision auf Domains aus (GMAIL/FIRMA/HOTMAIL).
- Electron: Mindestfenster 1180×760, Masthead als Drag-Region, Menü „Darstellung" nach Spec (⌘1 Posteingang, ⌘2 Wartet, ⌘3 Aufgaben; Chat ⌘5, Signal ⌘6).

### Erhalten (nicht im Handoff, bewusst behalten)

- Postfach-Chat („Frag die Eule", ⌘5) und Signal (⌘6) als Sheets im Papier-Stil; Neue-Mail-Overlay (⌘N) mit Empfänger-Chips/Autocomplete; Undo-Send; Update-Banner; Regeln (unter Intelligenz).

## [0.18.0] - 2026-07-04

### Geändert (Observatorium-Politur nach Screenshot-Selbst-Review)

- **Fenster-im-Fenster entfernt:** Der Inhalt sitzt wieder randlos auf dem Canvas (`.content-sheet` statt Glas-Insel); die Aurora leuchtet nur noch als oberer Glow und läuft weich aus (Masken-Fade).
- **Dock beschriftet:** permanente Labels unter den Glyphen; Tooltips zeigen jetzt die Tastenkürzel. **⌘1–⌘4** schalten Posteingang/Chat/Aufgaben/Signal (natives Menü „Darstellung" + Renderer-Fallback).
- **Konten-Cluster** als ruhige Kapsel: kleine Punkte ohne Button-Chrome, Fehler-Badge, Filter-Ring.
- **Senden-Button in Gold:** der Radial-Glow-Verlauf nutzt jetzt die Marken-Palette statt Blau/Teal.
- **Fokus-Ringe verfeinert** (1 px, ohne Offset); Composer-Felder zeigen Fokus über den Zeilen-Hintergrund.
- Kategorie-Leiste kompakt (Landing-Page-Abstand der Spotlight-Navbar entfernt); mehr Bodenfreiheit über dem Dock (Liste/Chat-Eingabe kollidieren nicht mehr).

### Behoben

- **Einstellungen/Konto-Dialog/Signal-Dialog schließen jetzt per Escape** (Capture-Handler) — vorher blieb der Settings-Dialog offen und blockierte sogar ⌘K.

### Technik

- Dev-Trigger `NOCTUA_TEST_SHOTS=1`: Screenshot-Tour aller Views via `webContents.capturePage` (Views über app:menuAction, Tasten via sendInputEvent) — Grundlage des Selbst-Reviews.

## [0.17.0] - 2026-07-04

### Geändert (großes Redesign: „Observatorium")

- **Layout-Revolution:** Die klassische Sidebar ist Geschichte. Die App ist jetzt ein Nachthimmel-Canvas: eine **WebGL-Aurora** (React Bits, ogl) wabert in Gold hinter einer schwebenden **Glas-Insel** (backdrop-blur, Hairline, weiche Schatten), navigiert wird über ein **Glass Dock** (Vengeance UI) unten mittig — mit handgezeichneten Noctua-Glyphen (Feder, Funke, Mond …), Spring-Hover, Tooltips samt Shortcut-Hinweisen und goldenem Aktiv-Punkt.
- **Konten als Cluster** in der Titelleiste: pulsierende Farbpunkte mit Status-Ring, Klick filtert den Posteingang (wie bisher in der Sidebar), Fehler werden rot markiert, „+" öffnet das Onboarding.
- **Kategorie-Tabs** sind jetzt eine **Spotlight-Navbar** (Vengeance UI): der Lichtkegel folgt der Maus.
- **Signal-Gruppen** wandern als Chip-Leiste in die Signal-Ansicht (inkl. „Gruppen verwalten"/„Signal koppeln"); der Kopplungs-QR steckt in einer **Glow-Border-Card**.
- **Composer:** „Senden" ist ein **Radial-Glow-Button**, während die AI schreibt tanzt ein **Kinetic-Text-Loader**.
- **Willkommens-Screen:** animierte **Rays**-Szene, **FlipText**-Tagline, **BlurText**-Hinweise, Glow-CTA.
- **Wortmarke** mit wanderndem Glanz (ShinyText); globale **ClickSpark**-Goldfunken bei jedem Klick; AI-Statistiken zählen mit **AnimatedNumber** hoch.

### Technik

- 8 Komponenten von Vengeance UI vendored (`components/vendor/`, via shadcn-Registry) + 4 React-Bits-Komponenten (`components/bits/`); neue devDeps: framer-motion, gsap, ogl, clsx, tailwind-merge; `@/`-Alias + `cn()`-Helper; `dark:`-Variante der Vendor-Komponenten auf `data-theme` gemappt; MorphSVGPlugin-Referenz entfernt (GSAP-Club-Plugin, nicht im freien Paket).
- Aurora respektiert `prefers-reduced-motion` (statisches Frame) und folgt dem Theme live.

## [0.16.0] - 2026-07-04

### Geändert

- **Editorial-Nocturne-Design** (Anti-Generik-Pass nach den Design-Skills): Eigenständige, lokal gebundelte Schriften statt System-Sans — **Fraunces Variable** (Serif-Display mit „Wonk"-Charakter: Wortmarke, Reader-Betreff, Composer-Kopf/Betreff, Dialog-Titel, Welcome), **Space Grotesk Variable** (gesamte UI) und **JetBrains Mono** (Zeiten, Zähler, kbd-Tasten, Statistik-Captions; tabellarische Ziffern).
- **Sektions-Labels**: Serif-Kursive statt ALL-CAPS-Letterspacing (Sidebar, Einstellungen, Shortcut-Overlay, Signal-Dialog, Follow-ups).
- **Kategorie-Tabs**: Editorial-Unterstrich-Tabs mit animierter Gold-Linie statt Pill-Chips.
- **Empty-State** der Inbox: Eulen-Augen + Mond als SVG mit Serif-Zeile („Alles gelesen. Die Eule ruht.").
- **Wortmarke** „Noctua." mit goldenem Punkt in Titelleiste und Welcome-Screen; Papier-Grain im Light-Mode leicht verstärkt.

### Technik

- Fonts via @fontsource (offline, CSP-safe, versioniert); keine externen Requests.

## [0.15.0] - 2026-07-04

### Hinzugefügt

- **Idee → Mail (Diktat-Flow):** ⌘J funktioniert jetzt auch bei NEUEN Mails. Idee einfach in den Text diktieren (macOS-Diktat: 2× fn) oder tippen — `ai:draftNew` formt daraus die versandfertige Mail im eigenen Stil und schlägt ohne vorhandenen Betreff per BETREFF-Streaming-Protokoll einen vor. Bei Antworten fließen diktierte Stichpunkte im Body als Grundlage in den Entwurf ein.
- **Schreibstil einstellbar:** Freitext-Anweisungen unter Einstellungen → „Schreibstil der AI-Entwürfe" (`ai.styleInstructions`); gelten für Antworten UND neue Mails und haben Vorrang vor dem gelernten Profil.
- **Signaturen pro Konto** (Migration 008, `accounts.signature`): Pflege in den Einstellungen, automatisches Anhängen im Composer, Tausch beim Konto-Wechsel, Wieder-Anhängen nach AI-Entwürfen; die AI wird angewiesen, selbst keine Signatur zu erzeugen.
- **Pfeiltasten-Navigation:** ↑/↓ bewegen die Auswahl in der Inbox (zusätzlich zu j/k).
- **Aufgaben: „Alle abhaken":** Button in der Aufgaben-Ansicht erledigt alle offenen Aufgaben auf einmal (`tasks:completeAll`); verworfene bleiben unberührt.
- **Konto-Filter:** Klick auf ein Konto in der Sidebar zeigt nur dessen Mails (`threads:list` mit accountId), erneuter Klick hebt den Filter auf; aktiver Filter ist gold hervorgehoben.
- Dev-Trigger `NOCTUA_TEST_DRAFT_NEW=1` (Idee→Mail live gegen das Draft-Modell).

## [0.14.0] - 2026-07-04

### Hinzugefügt

- **Empfänger-Autocomplete:** Beim Tippen in An/Cc schlägt Noctua Adressen aus der eigenen Mail-Historie vor (`contacts:suggest` auf `contact_stats`). Ranking: schon mal angeschrieben > nur empfangen, gewichtet nach Häufigkeit; eigene Konto-Adressen sind ausgefiltert. Auswahl per ↑/↓ + Enter/Tab oder Klick.
- **App-Logo:** Eigenes Eulen-Icon (Steinkauz mit goldenen Augen + Mondsichel) als `build/icon.svg`; `scripts/generate-icons.mjs` rastert daraus `build/icon.icns`, `build/icon.png` und `resources/icon.png` (sharp + iconutil). Im Dev-Modus zeigt das Dock das Logo via `app.dock.setIcon`.
- **Natives App-Menü** (deutsch): Noctua → Über/Einstellungen ⌘,, Ablage → Neue E-Mail ⌘N/Suchen ⌘F/Konto hinzufügen, Bearbeiten mit System-Rollen (Kopieren/Einsetzen), Darstellung → AI-Chat/Vollbild, Hilfe → Tastaturkürzel/GitHub. Menü-Aktionen laufen über den Push-Kanal `app:menuAction`. Hinweis: Der fette App-Name links kommt aus der Info.plist — im Dev-Modus „Electron", in der gebauten App „Noctua".

### Geändert

- **Composer-Redesign:** größeres Panel (max-w-3xl, Textfeld min. 46 vh), Empfänger als entfernbare Chips, goldene Akzentlinie im Kopf, Feldzeilen mit Fokus-Hervorhebung, Betreff prominenter, Wortzähler in der Fußzeile, ⌘↵/⌘J als Tasten-Hints in den Buttons.

## [0.13.0] — 2026-07-04

### Added

- **Sichtbarer „Schreiben"-Button** oben in der Sidebar (bisher nur über die
  unsichtbare Taste `c` erreichbar) und „Neue E-Mail schreiben" in der ⌘K-Palette
- **Antworten-Buttons im Reader** („Antworten"/„Allen antworten" unter dem
  Thread — zusätzlich zu r/a)
- **Absender-Konto wählbar** im Composer (Dropdown bei neuen Mails — relevant,
  seit mehrere Konten verbunden sind; Antworten behalten ihr Konto)

### Fixed

- **Shortcuts auf deutschem Tastaturlayout**: `/` (Suche, liegt auf Shift+7),
  `?` (Shortcut-Übersicht, Shift+ß), `⇧3` (Löschen) und `⇧U` (ungelesen)
  funktionierten nicht, weil die Shortcut-Bibliothek Shift-Varianten und
  Layout-Zeichen nicht matchte — jetzt layoutunabhängig registriert

## [0.12.1] — 2026-07-04

### Fixed

- Microsoft-Login schlug mit `invalid_scope` fehl: Die OAuth-Scopes zeigen
  jetzt auf die Resource `outlook.office.com`, für die die verwendete
  Public-Client-App registriert ist (Tokens gelten weiterhin für den
  Server `outlook.office365.com`)

## [0.12.0] — 2026-07-04

### Added

- **Microsoft-/Hotmail-Konten** über OAuth2: Anmeldung läuft im System-Browser
  (Noctua sieht das Passwort nie), Tokens landen verschlüsselt im Vault,
  IMAP spricht XOAUTH2, Versand läuft über nodemailer-OAuth2 (Port 587,
  STARTTLS); Access-Tokens werden bei jedem (Re-)Connect still erneuert
- Da Microsoft App-Registrierungen für persönliche Konten abgeschafft hat,
  nutzt Noctua standardmäßig Thunderbirds öffentliche Public-Client-ID
  (gängige OSS-Praxis, kein Secret) — über die Einstellung
  „Microsoft Client-ID" jederzeit durch eine eigene Registrierung ersetzbar
- Onboarding-Tab „Microsoft" mit Ein-Klick-Browser-Login; die Adresse kommt
  aus dem Microsoft-Konto selbst (kein Formular)

### Changed

- Sync-Engine bezieht Zugangsdaten jetzt über einen Credential-Provider
  (statisches Passwort ODER frisches OAuth-Token) — Grundlage auch für Proton

## [0.11.1] — 2026-07-03

### Added

- Test-Suite mit Vitest (81 Tests): Threading (Betreff-Normalisierung,
  JWZ-light-Referenz-Gruppierung, Fallbacks), MIME-Parser, Ingest inkl.
  Gmail-Dedupe und Flag-Updates, FTS-Volltextsuche, Tab-Filter, Aufgaben-
  Extraktion + Dedup, deterministisches Regel-Matching, Budget-Mathematik,
  Outbox/Undo-Send, IPC-Contract-Validierung, Datums-Formatierung und alle
  sieben Migrationen gegen eine In-Memory-DB
- GitHub-Actions-CI: Typecheck + Tests bei jedem Push und Pull Request
- Selbstheilendes `pnpm test` (baut better-sqlite3 für Node, testet, stellt
  den Electron-Build wieder her) plus `scripts/rebuild-electron.mjs`

### Changed

- Interne Pure-Funktionen für Tests exportiert (rules.matches,
  unsubscribe.parseHeaderUrls, updates.newer); Test-Naht `__setTestDb` in
  der DB-Schicht

## [0.11.0] — 2026-07-03

### Added

- **Undo Send**: Gesendetes wandert erst in eine Outbox und geht nach einem
  Rückgängig-Fenster (Default 30 s, einstellbar) raus; Countdown-Toast mit
  „Rückgängig", das den Entwurf in den Composer zurückholt
- **Smart Notifications**: native macOS-Benachrichtigungen nur für frische,
  ungelesene Mails ab Priorität 4 (einstellbar), P5 mit Ton; Klick öffnet den
  Thread; Dock-Badge zählt nur Wichtiges (keine Newsletter/Werbung)
- **Multi-Select + Bulk-Aktionen**: `x` markiert Threads, ⌘A alle, Esc hebt auf;
  e/⇧3/⇧U/s wirken auf die ganze Auswahl; Auswahl-Leiste mit Zähler
- **Unsubscribe-Assistent**: Abmelden-Button im Reader nutzt RFC 8058 One-Click
  (stiller POST), sonst mailto über die Outbox oder Browser-Fallback;
  Kandidaten-Erkennung für nie geöffnete Massen-Absender
- **Regeln in natürlicher Sprache**: „Hetzner-Rechnungen archivieren und als
  Aufgabe" → AI übersetzt das einmalig in eine deterministische Regel, die
  danach ohne LLM greift (Absender/Betreff/Kategorie/Priorität →
  Archiv/Gelesen/Stern/Kategorie/Aufgabe); Verwaltung in den Einstellungen
- **Update-Check** gegen GitHub-Releases mit Banner + Ein-Klick-Download
  (automatische Installation braucht Apple-Signatur, daher Download)

## [0.10.0] — 2026-07-03

### Changed

- Komplettes Design-Overhaul (Audit nach redesign-Skill):
  **Light Mode** (warmes Papier) + überarbeiteter Dark Mode (warmes
  Nachtdunkel statt Blauschwarz), umschaltbar unter ⌘, (System/Hell/Dunkel,
  folgt macOS) — Fensterfarbe zieht mit
- Neuer Marken-Akzent: Eulen-Gold statt AI-Lila; eine Grau-Familie,
  getönte Schatten, subtiles Korn gegen digitale Flachheit
- Motion-Sprache: Panels skalieren sanft ein, Reader-Karten erscheinen
  gestaffelt, Listen-Hover/Auswahl mit Akzent-Indikator, Task-Häkchen mit
  Spring-Pop, Sync-Punkte pulsieren, Streaming-Cursor blinkt ruhig;
  respektiert prefers-reduced-motion
- Zustände überall: Skeleton-Loader statt Ladetext, sichtbare Focus-Ringe
  (Tastatur-Navigation), aktive Nav-/Tab-Indikatoren, Pressed-Feedback
- Einheitliche Komponentenklassen (btn/input/panel/overlay/chip) — weniger
  Duplikation, konsistente Radien und Übergänge

## [0.9.0] — 2026-07-03

### Added

- M8 **Lokale Embeddings**: multilingual-e5-small läuft direkt auf dem Mac
  (transformers.js, quantisiert, einmaliger ~120-MB-Download nach
  userData/models) — Mail-Inhalte verlassen den Rechner fürs Indexieren nicht
- sqlite-vec-Vektorindex (Migration 006, vec0, 384 Dimensionen); Nachrichten
  werden im Hintergrund automatisch indexiert (Batch, inkrementell)
- **Hybrid-Retrieval im Postfach-Chat**: semantische KNN-Treffer und
  Volltext-Treffer werden dedupliziert kombiniert — Fragen wie „Was zahle ich
  für mein Abo für künstliche Stimmen?" finden die ElevenLabs-Rechnung, ohne
  dass ein Wort übereinstimmt; fällt ohne Modell sauber auf Volltext zurück

## [0.8.0] — 2026-07-03

### Added

- M7a **Follow-up-Radar**: gesendete Mails ohne Antwort werden nach x Tagen
  (Default 3) erkannt — ein einmaliger AI-Check filtert Mails, die gar keine
  Antwort erwarten; „Wartet auf Antwort"-Sektion im Aufgaben-Bereich mit
  Ein-Klick-Nachfassen (öffnet den Composer mit fertigem AI-Nachfass-Entwurf;
  gesendet wird weiterhin nur manuell)
- M7b **Stil-Profil**: Noctua lernt einmalig Schreibstil, Anreden und
  Grußformeln aus den gesendeten Mails und erkennt zusätzlich das Register
  pro Kontakt (Du/Sie, übliche Anrede) — AI-Entwürfe treffen den eigenen Ton
  je nach Empfänger; Refresh über die Command-Palette
- M7c **AI-Chat übers Postfach** (g c): Fragen in natürlicher Sprache,
  beantwortet aus den eigenen Mails mit klickbaren Quellen-Verweisen
  (Query-Expansion → Volltext-Retrieval → gestreamte Antwort)
- Sent-Ordner-Bodies werden mitgeladen (Material für Stilprofil/Beispiele)

### Changed

- Triage-Prompt v3 nach Qualitäts-Review: Produkt-Marketing genutzter Dienste
  zählt als Werbung; Dienst-Warnungen mit Folgen (Speicher voll, Zahlung
  fehlgeschlagen) bekommen Priorität 4

## [0.7.0] — 2026-07-03

### Added

- M6: Signal-Anbindung über signal-cli als gekoppeltes Gerät (lokal, kein
  Cloud-Dienst): Kopplung per QR-Code direkt in der App, Daemon mit JSON-RPC
  über UNIX-Socket, automatischer Neustart bei Abbrüchen
- Gruppen-Verwaltung mit doppeltem Opt-in: nur „Lesen"-Gruppen werden
  überhaupt gespeichert, AI-Scanning (Priorität, Zusammenfassung, Aufgaben)
  ist pro Gruppe separat zuschaltbar — E2E-verschlüsselte Chats gehen nie
  ungefragt an einen LLM-Provider
- Signal-Bereich in der Sidebar + Nachrichten-Ansicht mit Prioritätsmarkern
  und AI-Einzeilern; wichtige Gruppen-Nachrichten erzeugen Aufgaben
  (gleiches Task-System wie Mails, 💬-Quellenverweis)

## [0.6.0] — 2026-07-03

### Added

- M5: Automatische Aufgaben aus Mails — die Triage (Prompt v2) extrahiert
  konkrete Action-Items mit Fälligkeitsdatum; Aufgaben entstehen nur aus
  konfigurierten Kategorien (Default: Persönlich/Arbeit/Transaktion) und
  optional als „Antworten:"-Aufgabe bei erwarteter Antwort
- Aufgaben-Ansicht (g t / Sidebar mit Zähler): abhaken (x), verwerfen (d),
  Sprung zur Quell-Mail (↵); überfällige Fristen werden markiert
- Dedupe über UNIQUE-Index — Re-Scans erzeugen keine doppelten Aufgaben
- Vorbereitung M6: Signal-Schema (Migration 004) und QR-Code-Paket

## [0.5.0] — 2026-07-03

### Added

- M4: Attachments sichern per Klick (Save-Dialog); `cid:`-Inline-Bilder werden
  als data-URIs eingebettet und rendern im Reader
- Remote-Bilder-Steuerung: Bilder werden geparkt statt geladen (weiterhin null
  Netz-Requests ohne Freigabe), pro Nachricht einblendbar oder dauerhaft pro
  Absender erlaubt (Allowlist)
- Shortcut-Übersicht unter `?`
- DMG-Build (ad-hoc-signiert) via `pnpm build:mac`

### Changed

- CSP erlaubt `img-src https:` — das Blocken übernimmt jetzt der
  Bild-Transform vor dem Rendern (ermöglicht die Freigabe-Funktion)

## [0.4.0] — 2026-07-03

### Added

- M3: Composer (c neu, r antworten, a allen antworten, ⌘↵ senden, Esc schließen)
  mit korrektem Reply-Threading (In-Reply-To/References aus der Originalmail)
- SMTP-Versand über nodemailer je Konto (Credentials aus dem Vault);
  Sent-Ordner wird nach dem Senden gezielt nachgezogen, Nicht-INBOX-Ordner
  pollen alle 10 Minuten
- AI-Antwortentwürfe (⌘J im Composer): Opus streamt live in den Editor,
  mit Thread-Kontext, 3 Stilbeispielen aus dem Sent-Ordner (bevorzugt an
  dieselbe Gegenstelle) und optionaler Ein-Satz-Regie; Senden bleibt manuell
- contact_stats-Aufbau aus Sent/INBOX (Prioritäts-Boost + Stilbeispiel-Wahl)
- Dev-Roundtrip-Tests (NOCTUA_TEST_SELF_SEND / NOCTUA_TEST_DRAFT)

## [0.3.0] — 2026-07-03

### Added

- M2: AI-Triage über OpenRouter — jede eingehende Mail (INBOX, ≤30 Tage) wird
  automatisch kategorisiert (persönlich/Arbeit/Newsletter/Werbung/Update/
  Transaktion), priorisiert (1–5) und auf Deutsch zusammengefasst
- Job-Queue mit Concurrency 2, Retry/Backoff, UNIQUE-Cache (nie doppelt
  scannen), Re-Scan-Kommando bei Prompt-Updates (⌘K)
- Deterministische Signale im Prompt: List-Unsubscribe-Header (Migration 002),
  Sender-Historie, bisherige Kategorien; Regel-Boosts nach dem Modell
  (bekannter Kontakt +1, Massenmail −1); Nutzer-Override schlägt das Modell
  dauerhaft (Taste `l`)
- Split-Inbox-Tabs (Alle/Wichtig/Persönlich/Newsletter/Werbung/Updates/Rest),
  AI-Summary + Prioritätsmarker + „Antwort erwartet"-Badge in der Liste
- Hartes Budget-Gate (Tages-/Monatslimit) mit Kosten-Tracking pro Modell und
  Banner bei Pausierung; Einstellungen (⌘,) mit Modellen, Budget, Key-Verwaltung

## [0.2.0] — 2026-07-03

### Added

- M1: Konten-Onboarding (Gmail per App-Passwort, generisches IMAP; UI-Dialog
  und ⌘K-Kommando), Credentials im safeStorage-Vault, Dev-Seed über Env-Vars
- IMAP-Sync-Engine (imapflow): 2 Verbindungen pro Konto (Kommandos + IDLE),
  SPECIAL-USE-Ordnererkennung, 90-Tage-Envelope-Backfill in 200er-Chunks,
  Body-Backfill (30 Tage, INBOX), inkrementeller Sync mit UIDVALIDITY-Reset,
  Flags-/Expunge-Resync-Fenster, Reconnect mit Exponential-Backoff + Jitter,
  Wake nach System-Resume
- Mail-Pipeline: postal-mime-Parser, Threading (Gmail X-GM-THRID, JWZ-light
  über References, Subject-Fallback), FTS5-Indexierung, Gmail-Dedupe
- Unified Inbox: virtualisierte Thread-Liste mit Konto-Farbpunkt, Ungelesen-
  Markern und Attachment-/Flag-Indikatoren; Reader mit sanitized HTML
  (DOMPurify + CSP blockt Remote-Bilder/Tracking-Pixel), Plaintext-Linkify
- Keyboard-Aktionen: j/k Navigation, Enter öffnen, u/Esc zurück, e Archiv,
  ⇧3 Löschen, ⇧U ungelesen, s Stern, / Volltextsuche
- Offline-fähige Op-Queue: optimistische UI, IMAP-Ops (Flags/Move/Delete)
  mit Retry; Gmail-Archiv-Semantik (Expunge in INBOX)
- Sync-Status und Backfill-Fortschritt live in der Sidebar

## [0.1.0] — 2026-07-03

### Added

- M0-Fundament: Electron + TypeScript + React (electron-vite), Tailwind v4 Dark-Theme
- Security-Baseline: sandboxed Renderer (contextIsolation, kein nodeIntegration), CSP,
  Navigations-/Window-Open-Blockade, externe Links nur https/mailto via System-Browser
- Typisierter IPC-Vertrag (`src/shared/ipc-contract.ts`) mit zod-Validierung
  main-seitig und Kanal-Whitelist im Preload
- SQLite-Layer (better-sqlite3, WAL) mit Migrations-Runner; Schema v1: Konten,
  Ordner, Nachrichten, Threads, AI-Annotationen, Job-Queue, FTS5-Volltextindex
- Secrets-Vault über Electron safeStorage (macOS Keychain-gestützt)
- App-Shell im Superhuman-Stil: dunkles Grundlayout, Command-Palette (⌘K, cmdk),
  Keyboard-Gerüst (tinykeys)
