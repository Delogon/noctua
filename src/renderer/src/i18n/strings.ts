// String-Tabelle des Letterpress-Designs (aus dem ursprünglichen Design-Handoff).
// („Noctua Mail.dc.html" = EN kanonisch, „Noctua Mail DE.dc.html" = DE).
// Platzhalter in {braces} werden von t() ersetzt.

export type Lang = 'de' | 'en'

const table = {
  // ── Allgemein ──
  cancel: { en: 'Cancel', de: 'Abbrechen' },
  noSubject: { en: '(No subject)', de: '(Kein Betreff)' },

  // ── Die eine Toast-Leiste (Design 1c) ──
  toastUndo: { en: 'Undo', de: 'Rückgängig' },
  toastDismiss: { en: 'Dismiss', de: 'Schließen' },
  toastSendingIn: { en: 'Sending as {addr} in {n}s', de: 'Geht in {n}s als {addr} raus' },
  toastSending: { en: 'Sending…', de: 'Geht gerade raus…' },
  toastSentAs: { en: 'Sent as {addr}', de: 'Gesendet als {addr}' },
  toastSendFailed: {
    en: 'Send failed — your draft is safe.',
    de: 'Senden fehlgeschlagen — dein Entwurf ist noch da.'
  },
  toastSendUnknown: {
    en: 'Sending was interrupted — it may have been sent. Check your Sent folder.',
    de: 'Senden unterbrochen — evtl. schon gesendet. Prüfe den Gesendet-Ordner.'
  },
  toastOpenDraft: { en: 'Open draft', de: 'Entwurf öffnen' },

  // ── Op-Queue: nicht ausführbare Aktionen (Dead-Letter) ──
  opsDeadAttempts: {
    en: '{n} action(s) could not be synced to the server and were dropped.',
    de: '{n} Aktion(en) ließen sich nicht mit dem Server abgleichen und wurden verworfen.'
  },
  opsDeadUidvalidity: {
    en: '{n} action(s) were dropped because the server folder was reset.',
    de: '{n} Aktion(en) wurden verworfen, weil der Serverordner zurückgesetzt wurde.'
  },
  opsDeadNoTarget: {
    en: '{n} action(s) failed: the Archive/Trash folder was not found on the server.',
    de: '{n} Aktion(en) gescheitert: Archiv-/Papierkorb-Ordner nicht auf dem Server gefunden.'
  },
  opsDeadFolderGone: {
    en: '{n} action(s) were dropped because the folder no longer exists.',
    de: '{n} Aktion(en) wurden verworfen, weil der Ordner nicht mehr existiert.'
  },

  // ── Update-Hinweis ──
  updateAvailable: { en: 'Version {v} is available', de: 'Version {v} ist verfügbar' },
  updateDownload: { en: 'Download', de: 'Herunterladen' },

  // ── Kategorie-Override (Taste l, Design 3d) ──
  overrideTitle: { en: 'Set category', de: 'Kategorie setzen' },
  overrideReset: { en: 'Let the owl decide again', de: 'Override zurücksetzen' },
  overrideFooterSet: { en: '1–7 / 0 SET', de: '1–7 / 0 SETZEN' },
  overrideFooterClose: { en: 'ESC CLOSE', de: 'ESC SCHLIESSEN' },
  catPersonal: { en: 'Personal', de: 'Persönlich' },
  catWork: { en: 'Work', de: 'Arbeit' },
  catNewsletter: { en: 'Newsletter', de: 'Newsletter' },
  catPromotions: { en: 'Promotions', de: 'Werbung' },
  catNotifications: { en: 'Notification', de: 'Benachrichtigung' },
  catTransactional: { en: 'Transaction', de: 'Transaktion' },
  catOther: { en: 'Other', de: 'Sonstiges' },

  // ── Remote-Bilder (Tracking-Schutz) ──
  remoteImagesBlockedOne: {
    en: '1 remote image blocked (tracking protection)',
    de: '1 Remote-Bild blockiert (Tracking-Schutz)'
  },
  remoteImagesBlocked: {
    en: '{n} remote images blocked (tracking protection)',
    de: '{n} Remote-Bilder blockiert (Tracking-Schutz)'
  },
  remoteImagesShow: { en: 'Show', de: 'Anzeigen' },
  remoteImagesAllowSender: { en: 'Always for {addr}', de: 'Immer für {addr}' },
  linkMismatchWarn: {
    en: 'Link text says {shown}, but it leads to {actual}',
    de: 'Der Linktext nennt {shown}, der Link führt aber zu {actual}'
  },
  linkMismatchOpen: { en: 'Open anyway', de: 'Trotzdem öffnen' },

  // ── Owl-View (Suchen + Fragen in einem Eingabefeld) ──
  chatEmptyTitle: { en: 'Ask your mailbox.', de: 'Frag dein Postfach.' },
  chatSuggestion1: {
    en: 'Which invoices did I receive this month?',
    de: 'Welche Rechnungen habe ich diesen Monat bekommen?'
  },
  chatSuggestion2: {
    en: 'What was the latest security alert?',
    de: 'Was war die letzte Sicherheitswarnung?'
  },
  chatSuggestion3: {
    en: 'Summarize my unread mail',
    de: 'Fasse meine ungelesenen Mails zusammen'
  },
  chatError: { en: 'Error: {msg}', de: 'Fehler: {msg}' },
  owlConvHead: { en: 'CONVERSATIONS', de: 'GESPRÄCHE' },
  owlNewChat: { en: 'NEW', de: 'NEU' },
  owlNewChatHint: { en: 'New question (n)', de: 'Neue Frage (n)' },
  owlConvSub: { en: "↳ = THE OWL'S ANSWER", de: '↳ = DIE ANTWORT DER EULE' },
  owlConvEmpty: { en: 'Nothing asked yet.', de: 'Noch nichts gefragt.' },
  owlConvEmptySub: {
    en: 'THE OWL REMEMBERS EVERY ANSWER',
    de: 'DIE EULE MERKT SICH JEDE ANTWORT'
  },
  owlKeyOpen: { en: 'open', de: 'öffnen' },
  owlKeyNew: { en: 'new question', de: 'neue Frage' },
  owlDeleteConv: { en: 'Delete conversation', de: 'Gespräch löschen' },
  owlInputPh: {
    en: 'Search your mail — ↵ asks the owl…',
    de: 'Durchsuch deine Post — ↵ fragt die Eule…'
  },
  owlFollowUpPh: { en: 'Ask a follow-up…', de: 'Frag weiter…' },
  owlEscClear: { en: 'ESC CLEAR', de: 'ESC LEEREN' },
  owlAskLabel: { en: 'Ask the owl:', de: 'Frag die Eule:' },
  owlAskNote: {
    en: 'SYNTHESIZED ANSWER · CITES THE HITS BELOW',
    de: 'FORMULIERTE ANTWORT · ZITIERT DIE TREFFER UNTEN'
  },
  owlAskDisabled: {
    en: 'the owl sleeps — add a key in Intelligence',
    de: 'Die Eule schläft — Schlüssel unter Intelligenz hinterlegen'
  },
  owlHitsLabel: { en: 'MAIL · BEST MATCHES', de: 'MAIL · BESTE TREFFER' },
  owlHitsNote: {
    en: 'LIVE FROM YOUR INDEX, NO TOKENS SPENT',
    de: 'LIVE AUS DEINEM INDEX, KEINE TOKENS VERBRAUCHT'
  },
  owlHitOpen: { en: '↵ OPEN', de: '↵ ÖFFNEN' },
  owlEmptySub: {
    en: 'THE OWL ANSWERS FROM YOUR MAIL — WITH SOURCES',
    de: 'DIE EULE ANTWORTET AUS DEINER POST — MIT QUELLEN'
  },
  owlYouAsked: { en: 'YOU ASKED · {time}', de: 'DU FRAGTEST · {time}' },
  owlAnsweredFrom: { en: 'answered from {n} threads', de: 'antwortete aus {n} Threads' },
  owlAnsweredFromOne: { en: 'answered from one thread', de: 'antwortete aus einem Thread' },
  owlAnsweredFromSources: { en: 'answered from {n} sources', de: 'antwortete aus {n} Quellen' },
  owlAnsweredFromOneSource: { en: 'answered from one source', de: 'antwortete aus einer Quelle' },
  owlSourcesAlsoChecked: {
    en: '+ {n} more threads checked, not cited in the answer',
    de: '+ {n} weitere Threads geprüft, in der Antwort nicht zitiert'
  },
  owlAnswering: { en: 'reading your mail…', de: 'liest deine Post…' },
  owlSources: { en: 'SOURCES', de: 'QUELLEN' },
  owlSourceOpen: { en: 'OPEN →', de: 'ÖFFNEN →' },
  owlYou: { en: 'YOU · {time}', de: 'DU · {time}' },
  owlFooterHits: { en: 'HITS', de: 'TREFFER' },
  owlFooterOpen: {
    en: 'OPEN SELECTED · ASK WHEN NONE',
    de: 'ÖFFNET DIE AUSWAHL · SONST FRAGT DIE EULE'
  },
  owlIndexStatus: {
    en: 'THE OWL INDEXES {n} MAILS · {coverage}% EMBEDDED · LOCAL',
    de: 'DIE EULE INDEXIERT {n} MAILS · {coverage}% EINGEBETTET · LOKAL'
  },

  // ── Konto-Dialog (Onboarding) ──
  addAccountTitle: { en: 'Add account', de: 'Konto hinzufügen' },
  addImapGeneric: { en: 'IMAP (generic)', de: 'IMAP (generisch)' },
  addMicrosoftButton: { en: 'Sign in with Microsoft', de: 'Mit Microsoft anmelden' },
  addMicrosoftNote: {
    en: 'Sign-in happens in your browser with Microsoft — Noctua never sees your password. Works with Hotmail, Outlook.com and Live addresses.',
    de: 'Die Anmeldung läuft über deinen Browser bei Microsoft — Noctua sieht dein Passwort nie. Funktioniert mit Hotmail-, Outlook.com- und Live-Adressen.'
  },
  addGoogleButton: { en: 'Sign in with Google', de: 'Mit Google anmelden' },
  addGoogleNote: {
    en: 'Sign-in happens in your browser with Google — Noctua never sees your password, no app password needed anymore.',
    de: 'Die Anmeldung läuft über deinen Browser bei Google — Noctua sieht dein Passwort nie, ein App-Passwort ist nicht mehr nötig.'
  },
  addSyncRangeLabel: { en: 'How far back should we sync?', de: 'Wie weit zurück synchronisieren?' },
  addSyncDefault: {
    en: 'Default — last 90 days (search: 6 months)',
    de: 'Standard — letzte 90 Tage (Suche: 6 Monate)'
  },
  addSync30: { en: 'Last 30 days', de: 'Letzte 30 Tage' },
  addSync90: { en: 'Last 90 days', de: 'Letzte 90 Tage' },
  addSync365: { en: 'Last year', de: 'Letztes Jahr' },
  addSyncAll: { en: 'Everything', de: 'Alles' },
  addLoginFailed: { en: 'Sign-in failed', de: 'Anmeldung fehlgeschlagen' },
  addWaitingForBrowser: { en: 'Waiting for browser sign-in…', de: 'Warte auf Browser-Anmeldung…' },
  addBrowserTabNote: {
    en: 'A browser tab has opened. Sign in and approve there — this window waits meanwhile.',
    de: 'Es hat sich ein Browser-Tab geöffnet. Dort anmelden und zustimmen — dieses Fenster wartet solange.'
  },
  addEmailPh: { en: 'Email address', de: 'E-Mail-Adresse' },
  addPasswordPh: { en: 'Password', de: 'Passwort' },
  addImapHostPh: { en: 'IMAP host', de: 'IMAP-Host' },
  addSmtpHostPh: { en: 'SMTP host', de: 'SMTP-Host' },
  addPortPh: { en: 'Port', de: 'Port' },
  addConnectionFailed: { en: 'Connection failed', de: 'Verbindung fehlgeschlagen' },
  addChecking: { en: 'Checking connection…', de: 'Prüfe Verbindung…' },
  addConnect: { en: 'Connect', de: 'Verbinden' },

  // ── Masthead ──
  navCompose: { en: 'NEW MAIL', de: 'NEUE MAIL' },
  navInbox: { en: 'INBOX', de: 'POSTEINGANG' },
  navWaiting: { en: 'WAITING', de: 'WARTET' },
  navTasks: { en: 'TASKS', de: 'AUFGABEN' },
  navSettings: { en: 'SETTINGS', de: 'EINSTELLUNGEN' },

  // ── Key-Strip / g-Hint ──
  keyMove: { en: 'move', de: 'bewegen' },
  keyFile: { en: 'delete', de: 'löschen' },
  keyDictate: { en: 'dictate', de: 'diktieren' },
  keyKeys: { en: 'keys', de: 'Tasten' },

  // ── Inbox-Liste ──
  mailboxFilterLabel: { en: 'MAILBOX', de: 'POSTFACH' },
  mailboxFilterAll: { en: 'ALL MAILBOXES', de: 'ALLE POSTFÄCHER' },
  mailboxFilterLoading: { en: 'LOADING…', de: 'LÄDT…' },
  mailboxFilterNone: { en: 'NO MAILBOX', de: 'KEIN POSTFACH' },
  mailboxFilterCount: { en: '{n} connected', de: '{n} verbunden' },
  mailboxFilterAria: {
    en: 'Filter correspondence by mailbox. Selected: {name}',
    de: 'Korrespondenz nach Postfach filtern. Ausgewählt: {name}'
  },
  mailboxTabsAria: { en: 'Mailbox folder', de: 'Postfachordner' },
  chipTask: { en: 'TASK', de: 'AUFGABE' },
  chipDraftReady: { en: 'DRAFT READY', de: 'ENTWURF BEREIT' },
  prioAria5: { en: 'ranked 5 of 5 — rings', de: 'Rang 5 von 5 — klingelt' },
  prioAria4: { en: 'ranked 4 of 5 — notifies', de: 'Rang 4 von 5 — benachrichtigt' },
  helpPrio5: { en: 'urgent — the owl ranked it 5, it rings', de: 'dringend — Rang 5, klingelt' },
  helpPrio4: { en: 'high — ranked 4, it notifies', de: 'wichtig — Rang 4, benachrichtigt' },
  triageHead: { en: 'TRIAGE', de: 'TRIAGE' },
  triagePriority: { en: 'PRIORITY {n} OF 5', de: 'PRIORITÄT {n} VON 5' },
  triageNeedsReply: { en: 'NEEDS A REPLY', de: 'ERWARTET ANTWORT' },
  prioNote: {
    en: 'ranked 4+ raises a desktop notification · 5 rings — set in Settings → Intelligence',
    de: 'Rang 4+ löst eine Desktop-Benachrichtigung aus · 5 klingelt — einstellbar unter Einstellungen → Intelligenz'
  },
  needsYou: { en: 'NEEDS YOU', de: 'BRAUCHT DICH' },
  needsYouAll: { en: 'ALL', de: 'ALLE' },
  filterClearAll: { en: 'reset', de: 'zurücksetzen' },
  filterChipRemove: { en: 'remove filter: {name}', de: 'Filter entfernen: {name}' },
  filterSectPriority: { en: 'PRIORITY', de: 'PRIORITÄT' },
  filterShowAll: { en: 'Show everything', de: 'Alles zeigen' },
  filterZero: { en: 'Nothing matches your filters.', de: 'Nichts passt zu deinen Filtern.' },
  filterZeroSub: { en: 'LOOSEN ONE, SEE MORE', de: 'EINEN LOCKERN, MEHR SEHEN' },
  needsYouRankNote: { en: '— ranked 4+', de: '— Rang 4+' },
  needsYouFilterLabel: { en: 'FILTER', de: 'FILTER' },
  keyNeedsYou: { en: 'needs you', de: 'braucht dich' },
  needsYouZero: { en: 'Nothing needs you first.', de: 'Nichts braucht dich zuerst.' },
  needsYouZeroSub: { en: 'RARE. ENJOY IT.', de: 'SELTEN. GENIESS ES.' },
  inboxZero: { en: 'Inbox zero.', de: 'Posteingang leer.' },
  inboxZeroSub: {
    en: 'THE OWL APPROVES · Z TO UNDO',
    de: 'DIE EULE IST ZUFRIEDEN · Z FÜR RÜCKGÄNGIG'
  },

  // ── Waiting ──
  waitingHead: { en: 'WAITING ON A REPLY', de: 'WARTET AUF ANTWORT' },
  waitingSub: { en: 'THE OWL COUNTS THE DAYS', de: 'DIE EULE ZÄHLT DIE TAGE' },
  daysSilent: { en: '{d}d silent', de: '{d} T. still' },
  today: { en: 'today', de: 'heute' },
  nudgedToday: { en: 'NUDGED TODAY ✓', de: '✓ HEUTE GESTUPST' },
  waitingEmpty: { en: 'Nobody owes you a reply.', de: 'Niemand schuldet dir eine Antwort.' },
  waitingEmptySub: { en: 'RARE. ENJOY IT.', de: 'SELTEN. GENIESS ES.' },
  youArrow: { en: 'YOU →', de: 'DU →' },
  sentDaysAgo: { en: 'SENT {d} DAYS AGO', de: 'GESENDET VOR {d} TAGEN' },
  sentToday: { en: 'SENT TODAY', de: 'HEUTE GESENDET' },
  silence: { en: 'SILENCE', de: 'STILLE' },
  silenceLine: {
    en: '{d} days without an answer. The owl suggests a gentle nudge.',
    de: '{d} Tage ohne Antwort. Die Eule schlägt einen freundlichen Stups vor.'
  },
  silenceToday: {
    en: 'Sent today — the owl starts counting tonight.',
    de: 'Heute gesendet — die Eule zählt ab heute Nacht.'
  },
  nudgeLabel: { en: 'NUDGE, DRAFTED IN YOUR VOICE', de: 'STUPS, IN DEINER STIMME ENTWORFEN' },
  nudgeSub: { en: '— polite, no pressure', de: '— höflich, ohne Druck' },
  sendNudge: { en: 'SEND NUDGE', de: 'STUPS SENDEN' },
  stopWaiting: { en: 'STOP WAITING', de: 'NICHT MEHR WARTEN' },
  nudgedNote: {
    en: 'The owl will tell you the moment they answer.',
    de: 'Die Eule sagt dir sofort Bescheid, wenn die Antwort kommt.'
  },
  composerNudgePlaceholder: {
    en: 'The owl drafts your nudge — edit, dictate, or rewrite it…',
    de: 'Die Eule entwirft deinen Stups — bearbeite, diktiere oder formuliere ihn um…'
  },
  originalSentMail: { en: 'YOUR ORIGINAL SENT MAIL', de: 'DEINE URSPRÜNGLICH GESENDETE MAIL' },
  originalMailLoading: { en: 'Loading the original mail…', de: 'Ursprüngliche Mail wird geladen…' },
  originalMailUnavailable: {
    en: 'The original mail is no longer available locally.',
    de: 'Die ursprüngliche Mail ist lokal nicht mehr verfügbar.'
  },

  // ── Tasks ──
  tasksHead: { en: 'TASKS — EXTRACTED FROM MAIL', de: 'AUFGABEN — AUS MAILS GEZOGEN' },
  tasksSub: { en: 'SPACE TO TICK', de: 'LEERTASTE HAKT AB' },
  tasksFilterStatus: { en: 'STATUS', de: 'STATUS' },
  tasksFilterOpen: { en: 'OPEN', de: 'OFFEN' },
  tasksFilterCompleted: { en: 'COMPLETED', de: 'ERLEDIGT' },
  tasksFilterAll: { en: 'ALL', de: 'ALLE' },
  tasksFilterNone: { en: 'NONE', de: 'KEINE' },
  tasksFilterNothing: { en: 'Nothing shown.', de: 'Nichts eingeblendet.' },
  tasksFilterNothingSub: {
    en: 'THE STATUS FILTER IS FULLY OFF',
    de: 'DER STATUS-FILTER IST KOMPLETT AUS'
  },
  tasksFilterAria: {
    en: 'Filter tasks by status. Current view: {state}',
    de: 'Aufgaben nach Status filtern. Aktuelle Ansicht: {state}'
  },
  taskFrom: { en: 'from {src}', de: 'aus {src}' },
  task: { en: 'TASK', de: 'AUFGABE' },
  extractedAuto: { en: 'extracted automatically', de: 'automatisch gezogen' },
  source: { en: 'SOURCE', de: 'QUELLE' },
  spaceDone: { en: 'DONE', de: 'ERLEDIGT' },
  spaceReopen: { en: 'REOPEN', de: 'WIEDER AUF' },
  spaceKey: { en: 'SPACE', de: 'LEERTASTE' },
  openThread: { en: 'O OPEN THREAD', de: 'O THREAD ÖFFNEN' },
  threadFiled: { en: 'That thread is deleted', de: 'Dieser Thread ist gelöscht' },
  tasksEmpty: { en: 'Nothing extracted yet.', de: 'Noch nichts gezogen.' },
  tasksEmptySub: { en: 'THE OWL READS ALONG', de: 'DIE EULE LIEST MIT' },
  tasksAllDone: { en: 'Everything is done.', de: 'Alles erledigt.' },
  tasksAllDoneSub: {
    en: 'COMPLETED TASKS ARE HIDDEN',
    de: 'ERLEDIGTE AUFGABEN SIND AUSGEBLENDET'
  },

  // ── Reading sheet / Task-Strip ──
  owlFoundTask: { en: 'THE OWL FOUND A TASK', de: 'DIE EULE FAND EINE AUFGABE' },
  tAdd: { en: 'T ADD', de: 'T ÜBERNEHMEN' },
  inYourTasks: { en: '✓ IN YOUR TASKS', de: '✓ IN DEINEN AUFGABEN' },
  mailDetailsShow: { en: 'DETAILS', de: 'DETAILS' },
  mailDetailsHide: { en: 'CLOSE', de: 'SCHLIESSEN' },
  mailDetailsFrom: { en: 'FROM', de: 'VON' },
  mailDetailsSender: { en: 'SENDER', de: 'VERSENDER' },
  mailDetailsTo: { en: 'TO', de: 'AN' },
  mailDetailsCc: { en: 'CC', de: 'CC' },
  mailDetailsBcc: { en: 'BCC', de: 'BCC' },
  mailDetailsReplyTo: { en: 'REPLY TO', de: 'ANTWORT AN' },
  mailDetailsSubject: { en: 'SUBJECT', de: 'BETREFF' },
  mailDetailsSent: { en: 'SENT', de: 'GESENDET' },
  mailDetailsReceived: { en: 'RECEIVED', de: 'EMPFANGEN' },
  mailDetailsSize: { en: 'SIZE', de: 'GRÖSSE' },
  mailDetailsMessageId: { en: 'MESSAGE ID', de: 'MESSAGE-ID' },
  mailDetailsSecurity: { en: 'DELIVERY & AUTHENTICATION', de: 'ZUSTELLUNG & AUTHENTIFIZIERUNG' },
  mailDetailsSecurityNote: {
    en: 'Reported mail-server signals — useful evidence, not a guarantee that the message is trustworthy.',
    de: 'Gemeldete Mailserver-Signale — hilfreiche Indizien, aber keine Garantie für die Vertrauenswürdigkeit der Mail.'
  },
  mailDetailsReplyMismatch: {
    en: 'The reply address uses a different domain than the visible sender.',
    de: 'Die Antwortadresse verwendet eine andere Domain als der sichtbare Absender.'
  },
  mailDetailsReturnPath: { en: 'RETURN PATH', de: 'RETURN-PATH' },
  mailDetailsDeliveredTo: { en: 'DELIVERED TO', de: 'ZUGESTELLT AN' },
  mailDetailsMailedBy: { en: 'MAILED BY', de: 'VERSENDET ÜBER' },
  mailDetailsSignedBy: { en: 'SIGNED BY', de: 'SIGNIERT VON' },
  mailDetailsReportedBy: { en: 'REPORTED BY', de: 'GEMELDET VON' },
  mailDetailsReceivedPath: { en: 'RECEIVED PATH · {n} HOPS', de: 'EMPFANGSWEG · {n} STATIONEN' },
  mailDetailsSpamSignals: { en: 'SPAM FILTER HEADERS', de: 'SPAMFILTER-HEADER' },
  mailDetailsAuthPass: { en: 'passed', de: 'bestanden' },
  mailDetailsAuthFail: { en: 'failed', de: 'fehlgeschlagen' },
  mailDetailsAuthSoftfail: { en: 'soft fail', de: 'Softfail' },
  mailDetailsAuthNeutral: { en: 'neutral', de: 'neutral' },
  mailDetailsAuthTemperror: { en: 'temporary error', de: 'temporärer Fehler' },
  mailDetailsAuthPermerror: { en: 'configuration error', de: 'Konfigurationsfehler' },
  mailDetailsAuthNone: { en: 'not provided', de: 'nicht angegeben' },
  mailDetailsAuthUnknown: { en: 'unknown', de: 'unbekannt' },
  mailDetailsLoading: {
    en: 'Fetching technical headers from the mailbox…',
    de: 'Technische Header werden vom Postfach abgerufen…'
  },
  mailDetailsLoaded: {
    en: 'Technical mail headers loaded.',
    de: 'Technische Mail-Header geladen.'
  },
  mailDetailsUnavailable: {
    en: 'Technical headers are not available right now. The basic sender and recipient data cached locally remains visible above.',
    de: 'Die technischen Header sind gerade nicht verfügbar. Die lokal gespeicherten Basisdaten zu Absender und Empfängern bleiben oben sichtbar.'
  },
  mailDetailsRaw: { en: 'RAW MESSAGE HEADERS', de: 'ROHE MAIL-HEADER' },
  mailDetailsRawTruncated: {
    en: 'Header display was capped at 512 KB.',
    de: 'Die Header-Anzeige wurde bei 512 KB begrenzt.'
  },

  // ── Masthead search ──
  mastheadSearch: { en: 'SEARCH', de: 'SUCHEN' },

  // ── Composer ──
  listening: { en: 'LISTENING', de: 'HÖRE ZU' },
  voiceNothingHeard: {
    en: 'Could not hear anything — please dictate again',
    de: 'Nichts zu hören — bitte nochmal einsprechen'
  },
  voiceQueryStart: {
    en: 'Dictate your question (⌘D)',
    de: 'Frage einsprechen (⌘D)'
  },
  voicePrefix: { en: 'voice:', de: 'stimme:' },
  send: { en: '↵ SEND', de: '↵ SENDEN' },
  redraft: { en: '⇧R REDRAFT', de: '⇧R NEUER WURF' },

  // ── Owl-Rail ──
  theOwl: { en: 'THE OWL', de: 'DIE EULE' },
  owlQuiet: { en: 'working quietly', de: 'arbeitet leise' },
  owlAsleepNoKey: { en: 'asleep — no key.', de: 'schläft — kein Schlüssel.' },
  owlListening: { en: 'listening…', de: 'hört zu…' },
  owlDraftingS: { en: 'drafting…', de: 'entwirft…' },
  railDrafts: { en: 'DRAFTS AWAITING YOU', de: 'ENTWÜRFE FÜR DICH' },
  railDraftNone: {
    en: 'None right now. Press {v} on any thread and talk — a draft appears here.',
    de: 'Gerade keiner. Drück {v} auf einem Thread und sprich — der Entwurf landet hier.'
  },
  railReview: { en: '↵ REVIEW', de: '↵ ANSEHEN' },
  railReplyTo: { en: 'Reply to {name}', de: 'Antwort an {name}' },
  railDraftDelete: { en: 'Discard draft', de: 'Entwurf verwerfen' },
  railDraftMore: { en: '+ {n} more', de: '+ {n} weitere' },
  toastDraftDeleted: { en: 'Draft discarded', de: 'Entwurf verworfen' },
  railTasksHead: { en: 'TASKS FROM MAIL', de: 'AUFGABEN AUS MAILS' },
  railOpenArrow: { en: '{n} open →', de: '{n} offen →' },
  railWaitingHead: { en: 'NO REPLY YET', de: 'KEINE ANTWORT BISHER' },
  railWaitingArrow: { en: '{n} waiting →', de: '{n} warten →' },
  nudgeBtn: { en: 'NUDGE', de: 'STUPS' },
  railNudgeNote: {
    en: 'nudges drafted in your voice — you approve every send',
    de: 'Stupser in deiner Stimme — du gibst jeden Versand frei'
  },
  yourStyle: { en: 'YOUR STYLE', de: 'DEIN STIL' },
  railVoiceNote: {
    en: 'Writing as {addr} — learned from your sent replies.',
    de: 'Schreibt als {addr} — gelernt aus deinen gesendeten Antworten.'
  },

  // ── Settings ──
  settingsHead: { en: 'SETTINGS — LOCAL, YOURS', de: 'EINSTELLUNGEN — LOKAL, DEINS' },
  setAccounts: { en: 'Accounts', de: 'Konten' },
  setStyle: { en: 'Style', de: 'Stil' },
  setIntel: { en: 'Intelligence', de: 'Intelligenz' },
  setAccountsSub: {
    en: '{n} connected · Google, Microsoft, IMAP',
    de: '{n} verbunden · Google, Microsoft, IMAP'
  },
  setStyleSub: { en: 'one per address', de: 'einer pro Adresse' },
  setIntelSubNoKey: { en: 'bring your own OpenRouter key', de: 'eigener OpenRouter-Schlüssel' },
  setIntelSub: { en: '{scan} scans · {write} writes', de: '{scan} scannt · {write} schreibt' },
  setTech: { en: 'Under the hood', de: 'Technik' },
  setTechSub: {
    en: 'how the owl thinks — in pictures',
    de: 'wie die Eule denkt — in Bildern'
  },
  connectedAddresses: { en: 'Connected addresses', de: 'Verbundene Adressen' },
  accountName: { en: 'Mailbox name', de: 'Postfachname' },
  accountNamePh: {
    en: 'Mailbox name, e.g. Personal or Europe',
    de: 'Postfachname, z. B. Privat oder Europa'
  },
  accountNameEditHint: {
    en: 'Edit mailbox name · saves automatically',
    de: 'Postfachnamen bearbeiten · speichert automatisch'
  },
  accountNameSaving: { en: 'saving…', de: 'speichert…' },
  accountNameSaved: { en: '✓ saved', de: '✓ gespeichert' },
  toastAccountNameRequired: {
    en: 'Please enter a unique mailbox name',
    de: 'Bitte einen eindeutigen Postfachnamen eingeben'
  },
  microsoftBrowserNote: {
    en: 'the Microsoft login opens in your browser',
    de: 'die Microsoft-Anmeldung öffnet sich im Browser'
  },
  googleBrowserNote: {
    en: 'the Google login opens in your browser — no app password needed',
    de: 'die Google-Anmeldung öffnet sich im Browser — kein App-Passwort mehr nötig'
  },
  accountsSub: {
    en: 'ONE STYLE PER ADDRESS · INDEXED LOCALLY',
    de: 'EIN STIL PRO ADRESSE · LOKAL INDEXIERT'
  },
  synced: { en: '✓ synced', de: '✓ synchron' },
  indexing: { en: 'indexing…', de: 'indexiert…' },
  errorState: { en: 'error', de: 'Fehler' },
  disconnect: { en: 'DISCONNECT', de: 'TRENNEN' },
  // Zweitklick-Bestätigung beim Trennen (Design 3b)
  disconnectHint: {
    en: 'removes the account + its local index',
    de: 'entfernt das Konto + seinen lokalen Index'
  },
  disconnectYes: { en: 'YES, DISCONNECT', de: 'JA, TRENNEN' },
  disconnectKeep: { en: 'KEEP', de: 'BEHALTEN' },
  // Sync-Fehler inline (Design 3b): gespeicherter Fehlertext + Zeitpunkt
  syncFailed: { en: 'sync failed', de: 'Sync gescheitert' },
  syncNeedsReauth: { en: 'sign-in needed', de: 'Anmeldung nötig' },
  syncNeedsReauthHint: {
    en: 'The server rejected the sign-in — update the password or sign in again.',
    de: 'Der Server hat die Anmeldung abgelehnt — Passwort aktualisieren oder neu anmelden.'
  },
  credReenter: { en: 'RE-ENTER PASSWORD', de: 'PASSWORT NEU EINGEBEN' },
  credSignInAgain: { en: 'SIGN IN AGAIN', de: 'ERNEUT ANMELDEN' },
  credNewPassword: { en: 'New password', de: 'Neues Passwort' },
  credSave: { en: 'SAVE', de: 'SPEICHERN' },
  credChecking: { en: 'checking···', de: 'prüft···' },
  credCancel: { en: 'CANCEL', de: 'ABBRECHEN' },
  toastCredUpdated: { en: 'Password updated', de: 'Passwort aktualisiert' },
  toastReauthorized: { en: 'Signed in again', de: 'Erneut angemeldet' },
  sinceTime: { en: 'since {time}', de: 'seit {time}' },
  addAddress: { en: 'ADD AN ADDRESS', de: 'ADRESSE HINZUFÜGEN' },
  waitingForBrowser: {
    en: 'waiting for the browser sign-in···',
    de: 'wartet auf die Browser-Anmeldung···'
  },
  waitingForBrowserHint: {
    en: '— check your browser window',
    de: '— schau in dein Browserfenster'
  },
  cancelCaps: { en: 'CANCEL', de: 'ABBRECHEN' },
  imapAddrPh: { en: 'address — you@yourdomain.de', de: 'Adresse — du@deinedomain.de' },
  imapHostPh: { en: 'imap host — mail.yourdomain.de', de: 'IMAP-Host — mail.deinedomain.de' },
  smtpHostOptionalPh: {
    en: 'smtp host — empty = same as imap',
    de: 'SMTP-Host — leer = wie IMAP'
  },
  imapPassPh: { en: 'password', de: 'Passwort' },
  connect: { en: 'CONNECT', de: 'VERBINDEN' },
  imapNote: {
    en: 'port 993 = SSL, others STARTTLS · Proton Bridge: 127.0.0.1, ports 1143/1025',
    de: 'Port 993 = SSL, sonst STARTTLS · Proton Bridge: 127.0.0.1, Ports 1143/1025'
  },
  accountsFootnote: {
    en: "New addresses appear in the filters after first sync. The owl reads that mailbox's sent folder and starts learning its style.",
    de: 'Neue Adressen tauchen nach dem ersten Sync in den Filtern auf. Die Eule liest den Gesendet-Ordner des Postfachs und lernt seinen Stil.'
  },
  mailCount: { en: '{n} mails', de: '{n} Mails' },
  customModelToggle: { en: 'custom model…', de: 'eigenes Modell…' },
  customModelNote: {
    en: 'The listed models are tried and tested. Any OpenRouter model works too — cost and fitness are then yours to judge. The test runs a sample mail through the scanner prompt.',
    de: 'Die gelisteten Modelle sind erprobt. Jedes OpenRouter-Modell geht auch — Kosten und Tauglichkeit kennen wir dann nicht. Der Test schickt eine Beispiel-Mail durch den Scanner-Prompt.'
  },
  customModelPh: {
    en: 'provider/model — e.g. moonshotai/kimi-k2',
    de: 'anbieter/modell — z. B. moonshotai/kimi-k2'
  },
  customModelTest: { en: 'TEST', de: 'TESTEN' },
  customModelApply: { en: 'USE MODEL', de: 'ÜBERNEHMEN' },
  customModelOk: {
    en: '✓ works — {ms} ms · ~{cost}',
    de: '✓ funktioniert — {ms} ms · ~{cost}'
  },
  customModelFailed: { en: 'test failed', de: 'Test fehlgeschlagen' },
  zdrHead: { en: 'PRIVACY', de: 'DATENSCHUTZ' },
  zdrLabel: {
    en: 'ZERO-DATA-RETENTION PROVIDERS ONLY',
    de: 'NUR ANBIETER OHNE DATENSPEICHERUNG'
  },
  zdrNote: {
    en: 'Requests are routed only to providers that don’t store prompts (ZDR). Turning this off can make more models available — without that guarantee.',
    de: 'Anfragen gehen nur an Anbieter, die Prompts nicht speichern (Zero Data Retention). Ausgeschaltet stehen ggf. mehr Modelle bereit — ohne diese Garantie.'
  },
  obSyncingMails: { en: 'LOADING MAILS · {n}', de: 'LÄDT MAILS · {n}' },
  obSyncNote: {
    en: 'mails keep loading in the background — you can already continue',
    de: 'Mails laden im Hintergrund weiter — du kannst schon fortfahren'
  },
  yourStyleHead: { en: 'Your style', de: 'Dein Stil' },
  styleSub: {
    en: 'ONE PER ADDRESS · LEARNED FROM SENT MAIL · STORED LOCALLY',
    de: 'EINER PRO ADRESSE · GELERNT AUS GESENDETEM · LOKAL GESPEICHERT'
  },
  styleIntro: {
    en: 'Every draft starts from the address you’re answering from. The owl studies each mailbox’s sent replies — tone, greetings, sign-offs, language — and writes accordingly.',
    de: 'Jeder Entwurf startet bei der Adresse, von der du antwortest. Die Eule studiert die gesendeten Antworten jedes Postfachs — Ton, Anreden, Grußformeln, Sprache — und schreibt entsprechend.'
  },
  learnFromSends: { en: 'learn from my sends', de: 'aus meinen Mails lernen' },
  retrain: { en: 'RETRAIN', de: 'NEU LERNEN' },
  voiceRulesLabel: { en: 'YOUR RULES FOR THIS ADDRESS', de: 'DEINE REGELN FÜR DIESE ADRESSE' },
  voiceRulesPh: {
    en: 'e.g. always informal, short sentences, sign off with “Cheers, Tim”',
    de: 'z. B. immer Du-Form, kurze Sätze, Gruß „Viele Grüße, Tim“'
  },
  previewBtn: { en: 'SAMPLE REPLY', de: 'PROBE' },
  previewRunning: { en: 'WRITING…', de: 'SCHREIBT…' },
  previewLabel: { en: 'SAMPLE — REPLY TO A TEST MAIL', de: 'PROBE — ANTWORT AUF EINE TESTMAIL' },
  voiceRulesSaved: { en: '✓ saved', de: '✓ gespeichert' },
  reading: { en: 'READING…', de: 'LIEST…' },
  replies: { en: '{n} replies', de: '{n} Antworten' },
  updatedToday: { en: 'updated today', de: 'heute gelernt' },
  updatedYesterday: { en: 'updated yesterday', de: 'gestern gelernt' },
  updatedDaysAgo: { en: 'updated {n} days ago', de: 'vor {n} Tagen gelernt' },
  // Ehrlich gescheitertes Nachlernen (Design 3e) — Gründe für ok:false
  voiceNoSent: {
    en: 'no sent replies to learn from yet',
    de: 'noch keine gesendeten Antworten zum Lernen'
  },
  noProfileYet: {
    en: 'not learned yet — press RETRAIN',
    de: 'noch nicht gelernt — drück NEU LERNEN'
  },
  tryIt: { en: 'TRY IT', de: 'PROBIER ES' },
  tryItLine: {
    en: 'Pick any thread in the inbox, press {v} — the reply arrives in that address’s voice.',
    de: 'Wähl einen Thread im Posteingang, drück {v} — die Antwort kommt in der Stimme dieser Adresse.'
  },
  styleFootnote: {
    en: 'Learned locally. Delete a style any time — the owl forgets politely.',
    de: 'Lokal gelernt. Lösch einen Stil jederzeit — die Eule vergisst höflich.'
  },
  intelligence: { en: 'Intelligence', de: 'Intelligenz' },
  intelSub: {
    en: 'BRING YOUR OWN KEY · CALLS GO STRAIGHT TO OPENROUTER · NOTHING PASSES THROUGH US',
    de: 'EIGENER SCHLÜSSEL · DIREKT ZU OPENROUTER · NICHTS LÄUFT ÜBER UNS'
  },
  orKeyHead: { en: 'OPENROUTER KEY', de: 'OPENROUTER-SCHLÜSSEL' },
  save: { en: 'SAVE', de: 'SPEICHERN' },
  orNoKey: {
    en: 'no key yet — scanning & drafting are paused until you add one',
    de: 'noch kein Schlüssel — Scannen & Entwerfen pausieren, bis du einen hinterlegst'
  },
  orSaved: {
    // Design 1b: „it never leaves this machine" — auch im Onboarding-Schritt 3
    en: '✓ saved · sk-or-•••• — in the macOS keychain, it never leaves this machine',
    de: '✓ gespeichert · sk-or-•••• — im macOS-Schlüsselbund, verlässt diesen Rechner nie'
  },
  modelScan: { en: 'MODEL — INBOX SCANNING', de: 'MODELL — POSTEINGANG-SCAN' },
  modelScanSub: {
    en: 'gists · tasks · silence-tracking, on every mail — cheap wins',
    de: 'Zusammenfassungen · Aufgaben · Stille-Zählung, bei jeder Mail — billig gewinnt'
  },
  modelWrite: { en: 'MODEL — WRITING', de: 'MODELL — SCHREIBEN' },
  modelWriteSub: {
    en: 'your drafts, your nudges — quality wins',
    de: 'deine Entwürfe, deine Stupser — Qualität gewinnt'
  },
  modelStt: { en: 'MODEL — DICTATION', de: 'MODELL — DIKTAT' },
  modelSttSub: {
    en: 'turns your voice into the idea — audio-capable models',
    de: 'macht aus deiner Stimme die Idee — audiofähige Modelle'
  },
  toastSttModel: {
    en: 'Dictation now transcribed by {model}',
    de: 'Diktat transkribiert jetzt {model}'
  },
  accountColor: { en: 'COLOR', de: 'FARBE' },
  // Privacy-Default gedreht (Design 3b): blocken, bis der Nutzer erlaubt
  privacyHead: { en: 'PRIVACY', de: 'PRIVATSPHÄRE' },
  imagesBlockToggle: {
    en: 'block remote images until I allow them',
    de: 'Bilder aus dem Netz blocken, bis ich sie erlaube'
  },
  imagesBlockNote: {
    en: 'per-sender allow remembers your choice',
    de: 'Freigaben pro Absender merkt sich die Eule'
  },
  intelFootnote: {
    en: 'No key? Mail still works — the owl just sleeps: no gists, no drafts, no counting.',
    de: 'Kein Schlüssel? Mail läuft trotzdem — die Eule schläft nur: keine Gists, keine Entwürfe, kein Zählen.'
  },

  // ── KI-Anbieter (Profile), Aufgaben-Zuordnung, Local only ──
  profilesHead: { en: 'AI PROVIDERS', de: 'KI-ANBIETER' },
  profilesSub: {
    en: 'OpenRouter or any OpenAI-compatible server — Ollama, LM Studio, vLLM, LiteLLM …',
    de: 'OpenRouter oder jeder OpenAI-kompatible Server — Ollama, LM Studio, vLLM, LiteLLM …'
  },
  profileLocal: { en: 'LOCAL', de: 'LOKAL' },
  profileExternal: { en: 'EXTERNAL', de: 'EXTERN' },
  profileName: { en: 'NAME', de: 'NAME' },
  profileUrl: { en: 'BASE URL', de: 'BASIS-URL' },
  profileStyle: { en: 'API STYLE', de: 'API-STIL' },
  profileStyleChat: { en: 'OpenAI Chat Completions', de: 'OpenAI Chat Completions' },
  profileStyleResponses: { en: 'OpenAI Responses', de: 'OpenAI Responses' },
  profileKey: { en: 'API KEY', de: 'API-SCHLÜSSEL' },
  profileKeyPh: { en: 'optional', de: 'optional' },
  profileKeySaved: { en: '✓ saved — type to replace', de: '✓ gespeichert — tippen zum Ersetzen' },
  profileNoKey: { en: 'no key saved', de: 'kein Schlüssel gespeichert' },
  profileKeyRemove: { en: 'remove key', de: 'Schlüssel entfernen' },
  profileIsLocal: {
    en: 'Runs locally or on-prem',
    de: 'Läuft lokal bzw. im eigenen Netz'
  },
  profileIsLocalNote: {
    en: 'Counts as local for “Local only”. Suggested from the address — you decide.',
    de: 'Zählt bei „Nur lokal“ als lokal. Vorschlag aus der Adresse — du entscheidest.'
  },
  profileTest: { en: 'TEST CONNECTION', de: 'VERBINDUNG TESTEN' },
  profileTestOk: {
    en: '✓ connected — {n} models · {ms} ms',
    de: '✓ verbunden — {n} Modelle · {ms} ms'
  },
  profileAdd: { en: '+ add provider', de: '+ Anbieter hinzufügen' },
  profileEdit: { en: 'edit', de: 'bearbeiten' },
  profileClose: { en: 'close', de: 'schließen' },
  profileDelete: { en: 'delete provider', de: 'Anbieter löschen' },
  profileBlockedLocalOnly: { en: 'blocked — Local only', de: 'gesperrt — Nur lokal' },
  toastProfileSaved: { en: '✓ {name} saved', de: '✓ {name} gespeichert' },
  taskProvider: { en: 'PROVIDER', de: 'ANBIETER' },
  taskBlockedLocalOnly: {
    en: 'External provider — paused while Local only is on. Pick a local one.',
    de: 'Externer Anbieter — pausiert, solange „Nur lokal“ an ist. Wähle einen lokalen.'
  },
  taskBlockedNoKey: {
    en: 'No key yet — this task is paused until you add one.',
    de: 'Noch kein Schlüssel — diese Aufgabe pausiert, bis du einen hinterlegst.'
  },
  taskBlockedNoModel: {
    en: 'No model chosen yet — pick one below.',
    de: 'Noch kein Modell gewählt — wähle unten eins.'
  },
  taskBlockedNoProfile: {
    en: 'This provider no longer exists — pick another.',
    de: 'Dieser Anbieter existiert nicht mehr — wähle einen anderen.'
  },
  sttProviderApple: {
    en: 'Apple speech recognition — on this Mac',
    de: 'Apple-Spracherkennung — auf diesem Mac'
  },
  taskAppleNote: {
    en: 'Runs on this Mac — no model, no key, no cost.',
    de: 'Läuft auf diesem Mac — kein Modell, kein Schlüssel, keine Kosten.'
  },
  toastTaskProfile: { en: 'Now using {name}', de: 'Nutzt jetzt {name}' },
  modelsFrom: { en: 'models from {name}', de: 'Modelle von {name}' },
  modelListSkipped: {
    en: 'Local only: the model list is not fetched automatically.',
    de: 'Nur lokal: die Modellliste wird nicht automatisch geholt.'
  },
  modelListLoad: { en: 'LOAD MODEL LIST', de: 'MODELLLISTE LADEN' },
  modelPick: { en: 'choose a model…', de: 'Modell wählen…' },
  modelFreeText: { en: 'or type a model id…', de: 'oder Modell-ID eintippen…' },
  localOnlyHead: { en: 'LOCAL ONLY', de: 'NUR LOKAL' },
  localOnlyLabel: {
    en: 'KEEP AI AND LOOKUPS ON THIS DEVICE',
    de: 'KI UND ABRUFE NUR AUF DIESEM GERÄT'
  },
  localOnlyNote: {
    en: 'AI uses only providers marked local. Nothing is fetched automatically from the internet: no update check, no model catalog, no search-model download, no remote images. Your mail servers and sign-in are not affected.',
    de: 'Die KI nutzt nur als lokal markierte Anbieter. Es wird nichts automatisch aus dem Internet geholt: kein Update-Check, kein Modellkatalog, kein Suchmodell-Download, keine Remote-Bilder. Mailserver und Anmeldung sind nicht betroffen.'
  },
  localOnlyBadge: { en: 'LOCAL ONLY', de: 'NUR LOKAL' },
  localOnlyBadgeTip: {
    en: 'Local only is on — click for settings',
    de: '„Nur lokal“ ist an — Klick öffnet die Einstellungen'
  },
  toastLocalOnlyOn: {
    en: 'Local only is on — AI and lookups stay on this device',
    de: 'Nur lokal ist an — KI und Abrufe bleiben auf diesem Gerät'
  },
  toastLocalOnlyOff: { en: 'Local only is off', de: 'Nur lokal ist aus' },
  onDemandHead: { en: 'ON DEMAND', de: 'AUF ANFORDERUNG' },
  onDemandNote: {
    en: 'These run by themselves in the background. With Local only they wait for your click.',
    de: 'Das läuft von selbst im Hintergrund. Mit „Nur lokal“ wartet es auf deinen Klick.'
  },
  onDemandNoteLocal: {
    en: 'Local only is on — nothing below runs by itself. Use the buttons when you want it.',
    de: '„Nur lokal“ ist an — nichts davon läuft von selbst. Nutze die Knöpfe, wenn du es willst.'
  },
  updatesHead: { en: 'UPDATES', de: 'UPDATES' },
  updateCheckBtn: { en: 'CHECK FOR UPDATES', de: 'AUF UPDATES PRÜFEN' },
  updateUpToDate: { en: 'You are up to date.', de: 'Du bist auf dem neuesten Stand.' },
  embedHead: { en: 'SEARCH MODEL', de: 'SUCHMODELL' },
  embedReady: {
    en: 'ready — semantic search on ({n}/{total} mails indexed)',
    de: 'bereit — semantische Suche an ({n}/{total} Mails indexiert)'
  },
  embedMissing: {
    en: 'not downloaded yet — it loads by itself, or start it now',
    de: 'noch nicht geladen — lädt von selbst, oder jetzt starten'
  },
  embedMissingLocal: {
    en: 'not downloaded — search uses full text only',
    de: 'nicht geladen — die Suche nutzt nur Volltext'
  },
  embedDownload: { en: 'DOWNLOAD SEARCH MODEL (~120 MB)', de: 'SUCHMODELL LADEN (~120 MB)' },
  embedDownloading: { en: 'DOWNLOADING…', de: 'LÄDT…' },
  toastEmbedReady: {
    en: '✓ Search model ready — indexing starts',
    de: '✓ Suchmodell bereit — Indexierung startet'
  },

  // ── Palette (nur Befehle — die Mailsuche wohnt bei der Eule) ──
  palPlaceholder: { en: 'Type a command…', de: 'Befehl eingeben…' },
  palAria: { en: 'Command palette', de: 'Befehlspalette' },
  palCommandMode: { en: 'COMMANDS ONLY', de: 'NUR BEFEHLE' },
  palCommandSection: { en: 'COMMANDS', de: 'BEFEHLE' },
  palFooterOwl: {
    en: 'MAIL SEARCH: / — WITH THE OWL',
    de: 'MAILSUCHE: / — BEI DER EULE'
  },
  palSearchError: {
    en: 'Local search is unavailable right now. Please try again.',
    de: 'Die lokale Suche ist gerade nicht verfügbar. Versuch es bitte erneut.'
  },
  palNoCommands: { en: 'No matching command.', de: 'Kein passender Befehl.' },
  palNoMail: {
    en: 'No reliable match in the local index.',
    de: 'Kein belastbarer Treffer im lokalen Index.'
  },
  palNoSubject: { en: '(no subject)', de: '(ohne Betreff)' },
  palUnknownSender: { en: 'Unknown sender', de: 'Unbekannter Absender' },
  palMailboxInbox: { en: 'Inbox', de: 'Eingang' },
  palMailboxSent: { en: 'Sent', de: 'Gesendet' },
  palMailboxArchive: { en: 'Archive', de: 'Archiv' },
  palMailboxOther: { en: 'Other folder', de: 'Anderer Ordner' },
  palHitClear: { en: 'CLEAR MATCH', de: 'KLARER TREFFER' },
  palHitPossible: { en: 'POSSIBLE', de: 'MÖGLICH' },
  palIndexLocal: { en: 'LOCAL MAIL SEARCH', de: 'LOKALE MAILSUCHE' },
  helpSearch: { en: 'search & ask the owl', de: 'suchen & die Eule fragen' },
  palChoose: { en: '↑↓ CHOOSE', de: '↑↓ WÄHLEN' },
  palRun: { en: '↵ RUN', de: '↵ AUSFÜHREN' },
  cmdReviewNudge: { en: 'Review nudge for {name}', de: 'Stups für {name} ansehen' },
  cmdDictate: { en: 'Dictate a reply to {name}', de: 'Antwort an {name} diktieren' },
  cmdHeroMove: { en: 'the hero move', de: 'der Königsweg' },
  cmdSummarize: { en: 'Summarize thread', de: 'Thread zusammenfassen' },
  cmdOwlsGist: { en: 'the owl’s gist', de: 'die Eule fasst zusammen' },
  cmdAcceptTask: { en: 'Accept found task', de: 'Gefundene Aufgabe übernehmen' },
  cmdGoInbox: { en: 'Go to Inbox', de: 'Zum Posteingang' },
  cmdGoWaiting: { en: 'Go to Waiting', de: 'Zu Wartet' },
  cmdGoTasks: { en: 'Go to Tasks', de: 'Zu Aufgaben' },
  cmdOpen: { en: '{n} open', de: '{n} offen' },
  cmdYourStyle: { en: 'Your style', de: 'Dein Stil' },
  cmdOnePerAddress: { en: 'one per address', de: 'einer pro Adresse' },
  cmdFilterAll: { en: 'Filter: all mailboxes', de: 'Filter: alle Postfächer' },
  cmdFilterOnly: { en: 'Filter: {name} only', de: 'Filter: nur {name}' },
  cmdOpenSettings: { en: 'Open Settings', de: 'Einstellungen öffnen' },
  cmdSettingsNote: { en: 'accounts · key · models', de: 'Konten · Schlüssel · Modelle' },
  cmdRefresh: { en: 'Check for new mail', de: 'Jetzt nach neuen Mails suchen' },
  cmdRefreshNote: { en: 'all accounts · incl. spam', de: 'alle Konten · inkl. Spam' },
  refreshTitle: { en: 'Check for new mail now', de: 'Jetzt nach neuen Mails suchen' },
  toastRefreshing: { en: 'Checking all mailboxes…', de: 'Alle Postfächer werden abgeglichen…' },
  cmdAddAddress: { en: 'Add an email address', de: 'E-Mail-Adresse hinzufügen' },
  cmdProviders: { en: 'Google · Microsoft · IMAP', de: 'Google · Microsoft · IMAP' },
  cmdChooseModels: { en: 'Choose models', de: 'Modelle wählen' },
  cmdShortcuts: { en: 'Show keyboard shortcuts', de: 'Tastaturkürzel zeigen' },
  cmdReplayOnboarding: { en: 'Replay onboarding', de: 'Onboarding wiederholen' },
  cmdCompose: { en: 'New email', de: 'Neue E-Mail' },
  cmdOwlSearch: { en: 'Search & ask the owl', de: 'Suchen & die Eule fragen' },
  cmdOwlSearchNote: {
    en: 'mail search lives here now',
    de: 'die Mailsuche wohnt jetzt hier'
  },
  cmdLanguage: { en: 'Sprache: Deutsch', de: 'Language: English' },

  // ── Hilfe ──
  helpTitle: { en: 'Keyboard', de: 'Tastatur' },
  helpSub: {
    en: 'EVERYTHING WORKS WITHOUT THE MOUSE · ESC TO CLOSE',
    de: 'ALLES GEHT OHNE MAUS · ESC SCHLIESST'
  },
  helpMove: { en: 'move through the list', de: 'durch die Liste bewegen' },
  helpDictate: {
    en: 'dictate a reply — the hero move (also: v)',
    de: 'Antwort diktieren — der Königsweg (auch: v)'
  },
  helpFile: { en: 'delete · edits an open draft', de: 'löschen · bearbeitet offenen Entwurf' },
  helpEnter: {
    en: 'finish dictation / run command',
    de: 'Diktat abschließen / Befehl ausführen'
  },
  helpSend: { en: 'send draft / nudge', de: 'Entwurf bzw. Stups senden' },
  helpReply: { en: 'reply by typing (list)', de: 'Antwort tippen (Liste)' },
  helpReplyAll: { en: 'reply to all (list)', de: 'allen antworten (Liste)' },
  helpReplyScopeToggle: {
    en: 'switch reply scope (in the editor)',
    de: 'Antwort-Umfang umschalten (im Editor)'
  },
  helpRedraft: { en: 'redraft — another take', de: 'neuer Wurf — andere Fassung' },
  helpIdeaToMail: { en: 'idea → mail (in the composer)', de: 'Idee → Mail (im Composer)' },
  sigImgReadError: { en: 'Could not read the image', de: 'Bild konnte nicht gelesen werden' },
  sigGreetingFallback: { en: 'Best regards', de: 'Viele Grüße' },
  helpTask: { en: 'accept / dismiss a found task', de: 'Aufgabe übernehmen / verwerfen' },
  helpOverride: {
    en: 'set category — overrides the owl',
    de: 'Kategorie setzen — überstimmt die Eule'
  },
  helpSummarize: { en: 'summarize thread', de: 'Thread zusammenfassen' },
  helpUndo: { en: 'undo last file-away', de: 'letztes Ablegen zurück' },
  helpFilter: {
    en: 'filter by mailbox · 0 shows all',
    de: 'nach Postfach filtern · 0 zeigt alle'
  },
  helpPalette: { en: 'commands', de: 'Befehle' },
  helpViews: {
    en: 'go straight to inbox · waiting · tasks',
    de: 'direkt zu Posteingang · Wartet · Aufgaben'
  },
  helpSettings: {
    en: 'settings — accounts · key · models',
    de: 'Einstellungen — Konten · Schlüssel · Modelle'
  },
  helpSignoff: {
    en: 'The owl works while you sleep.',
    de: 'Die Eule arbeitet, während du schläfst.'
  },

  // ── Toasts ──
  toastFiled: { en: 'Filed.', de: 'Abgelegt.' },
  toastNothingUndo: { en: 'Nothing to undo', de: 'Nichts rückgängig zu machen' },
  toastBackInbox: { en: 'Back in the inbox', de: 'Zurück im Posteingang' },
  toastTaskAdded: { en: 'Task added — {label}', de: 'Aufgabe übernommen — {label}' },
  toastTaskUpdateFailed: {
    en: 'Task could not be updated',
    de: 'Aufgabe konnte nicht aktualisiert werden'
  },
  toastTaskDismissed: {
    en: 'Dismissed — the owl won’t mention it again',
    de: 'Verworfen — die Eule erwähnt es nicht wieder'
  },
  toastNudgeSent: {
    en: 'Nudge sent to {name} — in your voice, gently',
    de: 'Stups an {name} — in deiner Stimme, sanft'
  },
  toastStopWaiting: { en: 'Stopped waiting on {name}', de: 'Wartet nicht mehr auf {name}' },
  toastOwlGist: { en: 'The owl: {gist}', de: 'Die Eule: {gist}' },
  toastNoQuestion: {
    en: 'Nothing to answer here — the owl found no question for you.',
    de: 'Hier gibt es nichts zu beantworten — die Eule fand keine Frage an dich.'
  },
  toastVoiceRefreshed: {
    en: 'Voice refreshed — the owl reread your sent mail',
    de: 'Stimme aufgefrischt — die Eule hat deine gesendeten Mails neu gelesen'
  },
  toastKeySaved: {
    en: '✓ Key saved locally — the owl wakes up',
    de: '✓ Schlüssel lokal gespeichert — die Eule wacht auf'
  },
  toastKeyInvalid: {
    en: 'That doesn’t look like an OpenRouter key (sk-or-…)',
    de: 'Das sieht nicht nach einem OpenRouter-Schlüssel aus (sk-or-…)'
  },
  toastScanModel: { en: 'Scanning now runs on {model}', de: 'Scannen läuft jetzt auf {model}' },
  toastScanApple: {
    en: 'Scanning now runs on-device (Apple Intelligence)',
    de: 'Scannen läuft jetzt lokal auf dem Gerät (Apple Intelligence)'
  },
  fmProviderCloud: { en: 'OpenRouter (cloud)', de: 'OpenRouter (Cloud)' },
  fmProviderApple: {
    en: 'Apple Intelligence — on this Mac',
    de: 'Apple Intelligence — auf diesem Mac'
  },
  fmProviderAppleSub: {
    en: 'triage runs on-device, mail text never leaves this machine — tasks only for clear personal requests',
    de: 'Triage läuft auf dem Gerät, Mail-Text verlässt den Rechner nicht — Aufgaben nur bei klarer persönlicher Bitte'
  },
  fmStateAvailable: { en: 'available', de: 'verfügbar' },
  fmStateOff: {
    en: 'Apple Intelligence is turned off in System Settings',
    de: 'Apple Intelligence ist in den Systemeinstellungen ausgeschaltet'
  },
  fmStateNotReady: {
    en: 'model is still downloading — try again later',
    de: 'Modell lädt noch — später erneut versuchen'
  },
  fmStateUnsupported: {
    en: 'needs macOS 26 on Apple Silicon',
    de: 'braucht macOS 26 auf Apple Silicon'
  },
  fmStateHelperMissing: {
    en: 'helper not built — run: pnpm run build:fm',
    de: 'Helper nicht gebaut — pnpm run build:fm ausführen'
  },
  fmStateError: { en: 'check failed', de: 'Prüfung fehlgeschlagen' },
  fmCloudDimmed: {
    en: 'cloud model unused while Apple Intelligence handles scanning',
    de: 'Cloud-Modell ruht, solange Apple Intelligence scannt'
  },
  toastWriteModel: { en: 'Drafts now written by {model}', de: 'Entwürfe schreibt jetzt {model}' },
  toastConnected: {
    en: '✓ {addr} connected — the owl starts learning that style',
    de: '✓ {addr} verbunden — die Eule lernt jetzt diesen Stil'
  },
  toastDisconnected: { en: '{addr} disconnected', de: '{addr} getrennt' },
  toastImapFields: {
    en: 'Address, host and app password — then we’re in',
    de: 'Adresse, Host und App-Passwort — dann klappt’s'
  },
  toastConnectOne: { en: 'Connect at least one address', de: 'Verbinde mindestens eine Adresse' },
  toastWelcome: {
    en: 'Welcome. Press ? for the keys — or just start with j and k.',
    de: 'Willkommen. Drück ? für die Tasten — oder starte einfach mit j und k.'
  },
  toastLangSwitched: { en: 'Language: English', de: 'Sprache: Deutsch' },

  // ── Onboarding ──
  obTagline: {
    en: 'MAIL, WITH AN OWL ON YOUR SHOULDER',
    de: 'MAIL, MIT EINER EULE AUF DER SCHULTER'
  },
  obIntro: {
    en: 'It reads with you, drafts in your voice, remembers who owes you a reply, and turns asks into tasks. You keep your hands on the keyboard — or just talk.',
    de: 'Sie liest mit, entwirft in deiner Stimme, merkt sich, wer dir eine Antwort schuldet, und macht Bitten zu Aufgaben. Deine Hände bleiben auf der Tastatur — oder du sprichst einfach.'
  },
  obConnectCta: { en: 'CONNECT YOUR MAIL — ↵', de: 'POST VERBINDEN — ↵' },
  obSkip: { en: 'skip for now', de: 'erstmal überspringen' },
  obStep2: { en: 'STEP 2 OF 4', de: 'SCHRITT 2 VON 4' },
  obStep3: {
    en: 'STEP 3 OF 4 — THE OWL’S EYES',
    de: 'SCHRITT 3 VON 4 — DIE AUGEN DER EULE'
  },
  obStep4: { en: 'STEP 4 OF 4 — YOUR VOICE', de: 'SCHRITT 4 VON 4 — DEINE STIMME' },
  obConnectHead: { en: 'Connect your addresses', de: 'Verbinde deine Adressen' },
  obConnectSub: {
    en: 'Noctua speaks Gmail, Outlook and IMAP. Everything is indexed locally.',
    de: 'Noctua spricht Gmail, Outlook und IMAP. Alles wird lokal indexiert.'
  },
  obConnect: { en: 'CONNECT', de: 'VERBINDEN' },
  obConnected: { en: 'CONNECTED', de: 'VERBUNDEN' },
  obContinue: { en: 'CONTINUE — ↵', de: 'WEITER — ↵' },
  obNothingLeaves: { en: 'nothing leaves your machine', de: 'nichts verlässt deinen Rechner' },
  obNConnected: { en: '{n} connected — indexed locally', de: '{n} verbunden — lokal indexiert' },
  obVoiceHead: { en: 'The owl learns your voice', de: 'Die Eule lernt deine Stimme' },
  obVoiceSub: {
    en: 'It studies what you’ve sent — per address — so drafts sound like you, not like a machine.',
    de: 'Sie studiert, was du gesendet hast — pro Adresse —, damit Entwürfe nach dir klingen, nicht nach Maschine.'
  },
  obReading: { en: 'reading your sent replies…', de: 'liest deine gesendeten Antworten…' },
  obDone: { en: 'DONE', de: 'FERTIG' },
  obEnterCta: { en: 'ENTER YOUR MAIL — ↵', de: 'REIN IN DIE POST — ↵' },
  obRetrainNote: {
    en: 'you can retrain any time under STYLE',
    de: 'jederzeit neu lernbar unter STIL'
  },

  // ── Onboarding — Schlüssel-Schritt + pausiertes Training (Design 1b) ──
  obKeyHead: { en: 'Bring your own key', de: 'Bring deinen eigenen Schlüssel' },
  obKeySub: {
    en: 'Gists, tasks and drafts run on OpenRouter with your key. Calls go straight there — nothing passes through us.',
    de: 'Gists, Aufgaben und Entwürfe laufen über OpenRouter mit deinem Schlüssel. Anfragen gehen direkt dorthin — nichts läuft über uns.'
  },
  obKeyLabel: { en: 'OPENROUTER API KEY', de: 'OPENROUTER-API-SCHLÜSSEL' },
  obKeySave: { en: 'SAVE — ↵', de: 'SPEICHERN — ↵' },
  obKeyFootnotePre: { en: 'no account yet? ', de: 'noch kein Konto? ' },
  obKeyFootnotePost: {
    en: ' — a few cents cover a busy week',
    de: ' — ein paar Cent reichen für eine volle Woche'
  },
  obKeyModelsNote: {
    en: 'MODELS COME WITH SENSIBLE DEFAULTS — CHANGE THEM ANYTIME IN SETTINGS → INTELLIGENCE',
    de: 'MODELLE KOMMEN MIT SINNVOLLEN VORGABEN — JEDERZEIT ÄNDERBAR UNTER EINSTELLUNGEN → INTELLIGENZ'
  },
  obTrainCta: { en: 'TRAIN MY VOICE — ↵', de: 'STIMME TRAINIEREN — ↵' },
  obKeySkip: {
    en: 'skip — the owl sleeps until then',
    de: 'überspringen — die Eule schläft bis dahin'
  },
  obPausedNoKey: { en: 'PAUSED — NO KEY', de: 'PAUSIERT — KEIN SCHLÜSSEL' },
  obFailed: { en: 'FAILED —', de: 'FEHLGESCHLAGEN —' },
  obRetry: { en: 'RETRY', de: 'NEU VERSUCHEN' },
  obPausedCallout: {
    en: 'The owl can’t read without its eyes. Add the key and training runs on its own.',
    de: 'Ohne ihre Augen kann die Eule nicht lesen. Hinterleg den Schlüssel, und das Training läuft von allein.'
  },
  obAddKey: { en: 'ADD KEY', de: 'SCHLÜSSEL HINTERLEGEN' },
  obPausedFootnote: {
    en: 'mail works without a key — the owl just sleeps',
    de: 'Mail läuft auch ohne Schlüssel — die Eule schläft nur'
  },

  // ── Compose-Overlay (Feature-Erhalt, nicht im Prototyp) ──
  composeTo: { en: 'TO', de: 'AN' },
  composeCc: { en: 'CC', de: 'CC' },
  composeBcc: { en: 'BCC', de: 'BCC' },
  composeHideCc: { en: 'Hide CC', de: 'CC ausblenden' },
  composeHideBcc: { en: 'Hide BCC', de: 'BCC ausblenden' },
  composeSubject: { en: 'SUBJECT', de: 'BETREFF' },
  composeFrom: { en: 'FROM', de: 'VON' },
  composeFromAria: {
    en: 'Sending from {name} — choose account',
    de: 'Gesendet wird von {name} — Konto wählen'
  },
  composeAutoSwitched: {
    en: '↳ switched to {name} — last used for {addr}',
    de: '↳ zu {name} gewechselt — zuletzt für {addr} verwendet'
  },
  composeDoubtfulAddr: {
    en: 'Doubtful address — the domain has no dot. Sends anyway if you insist.',
    de: 'Zweifelhafte Adresse — der Domain fehlt ein Punkt. Geht raus, wenn du darauf bestehst.'
  },
  composeNoSubject: { en: 'NO SUBJECT', de: 'OHNE BETREFF' },
  composeDraftFiled: {
    en: 'Draft filed — NEW MAIL brings it back',
    de: 'Entwurf abgelegt — NEUE MAIL holt ihn zurück'
  },
  composeChipRemove: { en: 'Remove {addr}', de: '{addr} entfernen' },

  mboxInbox: { en: 'INBOX', de: 'EINGANG' },
  mboxSent: { en: 'SENT', de: 'GESENDET' },
  mboxSpam: { en: 'SPAM', de: 'SPAM' },
  mboxSentNote: {
    en: 'Sent by you. If it awaits a reply, you’ll find it under WAITING.',
    de: 'Von dir geschickt. Wartet sie auf Antwort, findest du sie unter WARTET.'
  },
  mboxSpamNote: {
    en: 'Sorted out by the owl — links here are disarmed.',
    de: 'Von der Eule aussortiert — Links hier sind stumpf geschaltet.'
  },
  echoSending: { en: 'SENDING', de: 'WIRD GESENDET' },
  echoSendFailed: { en: 'SEND FAILED', de: 'NICHT GESENDET' },
  echoSendUnknown: { en: 'MAY HAVE BEEN SENT', de: 'EVTL. GESENDET' },
  echoSendUnknownHint: {
    en: 'May have been sent — check Sent folder',
    de: 'Evtl. gesendet — Gesendet-Ordner prüfen'
  },
  composeDraftRestored: { en: 'Draft restored', de: 'Entwurf wiederhergestellt' },
  tasksAutoHead: { en: 'TASKS FROM MAIL', de: 'AUFGABEN AUS MAILS' },
  tasksAutoSub: {
    en: 'The owl spots to-dos while reading',
    de: 'Die Eule erkennt To-dos beim Mitlesen'
  },
  tasksAutoToggle: { en: 'Create tasks automatically', de: 'Aufgaben automatisch anlegen' },
  tasksAutoNoteOn: {
    en: 'Found tasks go straight to your list.',
    de: 'Gefundene Aufgaben landen direkt in deiner Liste.'
  },
  tasksAutoNoteOff: {
    en: 'Suggestion in the mail only — accept with T.',
    de: 'Nur Vorschlag in der Mail — übernehmen mit T.'
  },

  // ── Regeln (Design 3c — Letterpress) ──
  rulesHead: { en: 'Rules', de: 'Regeln' },
  rulesSub: {
    en: 'describe it — the owl builds it deterministically',
    de: 'beschreib sie — die Eule baut sie deterministisch'
  },
  rulesPlaceholder: {
    en: 'e.g. “always archive Hetzner invoices and make a task”',
    de: 'z. B. „Hetzner-Rechnungen immer archivieren und als Aufgabe“'
  },
  rulesDraftBtn: { en: 'DRAFT — ↵', de: 'VORSCHLAG — ↵' },
  rulesDrafting: { en: 'THINKING…', de: 'DENKE…' },
  rulesShowJson: { en: 'SHOW RULE JSON ▸', de: 'REGEL-JSON ZEIGEN ▸' },
  rulesHideJson: { en: 'HIDE RULE JSON ▾', de: 'REGEL-JSON VERBERGEN ▾' },
  rulesActivate: { en: 'ACTIVATE RULE', de: 'REGEL AKTIVIEREN' },
  rulesDiscard: { en: 'DISCARD', de: 'VERWERFEN' },
  rulesActive: { en: 'Active', de: 'Aktiv' },
  rulesInactive: { en: 'Inactive', de: 'Inaktiv' },
  rulesHits: { en: '{n} hits so far', de: 'bisher {n} Treffer' },
  rulesDelete: { en: 'Delete rule', de: 'Regel löschen' },
  rulesEmpty: {
    en: 'No rules yet. Describe one above — the owl builds it deterministically.',
    de: 'Noch keine Regeln. Beschreibe oben eine — die AI baut sie deterministisch.'
  },
  syncRangeLabel: { en: 'SYNC RANGE', de: 'SYNC-ZEITRAUM' },
  syncRangeStd: {
    en: 'Default — 90 days (search: 6 months)',
    de: 'Standard — 90 Tage (Suche: 6 Monate)'
  },
  syncRange30: { en: 'Last 30 days', de: 'Letzte 30 Tage' },
  syncRange90: { en: 'Last 90 days', de: 'Letzte 90 Tage' },
  syncRange365: { en: 'Last year', de: 'Letztes Jahr' },
  syncRangeAll: { en: 'Everything', de: 'Alles' },
  syncRangeDays: { en: '{n} days', de: '{n} Tage' },
  toastSyncRange: {
    en: 'Sync range saved — adjusting in the background',
    de: 'Sync-Zeitraum gespeichert — wird im Hintergrund angepasst'
  },
  notSpamBtn: { en: 'NOT SPAM → INBOX', de: 'KEIN SPAM → EINGANG' },
  cmdFolderInbox: { en: 'Folder: Inbox', de: 'Ordner: Eingang' },
  cmdFolderSent: { en: 'Folder: Sent', de: 'Ordner: Gesendet' },
  cmdSig: { en: 'Edit signature', de: 'Signatur bearbeiten' },
  cmdSigNote: { en: 'builder \u00b7 image', de: 'Baukasten \u00b7 Bild' },
  setSig: { en: 'Signature', de: 'Signatur' },
  setSigSub: { en: 'builder \u00b7 one per address', de: 'Baukasten \u00b7 eine pro Adresse' },
  sigHead: { en: 'Signature builder.', de: 'Signatur-Baukasten.' },
  sigSub: {
    en: 'ONE SIGNATURE PER ADDRESS \u00b7 THE OWL APPENDS IT ON SEND',
    de: 'EINE SIGNATUR PRO ADRESSE \u00b7 DIE EULE H\u00c4NGT SIE BEIM SENDEN AN'
  },
  sigBlocks: { en: 'BLOCKS', de: 'BAUSTEINE' },
  sigBlocksHint: { en: 'click to add or remove', de: 'klicken zum Hinzuf\u00fcgen oder Entfernen' },
  sigShape: { en: 'SHAPE', de: 'FORM' },
  sigShapeCircle: { en: 'CIRCLE', de: 'KREIS' },
  sigShapeRounded: { en: 'ROUNDED', de: 'ABGERUNDET' },
  sigShapeRect: { en: 'SQUARE', de: 'ECKIG' },
  sigPosLeft: { en: 'LEFT', de: 'LINKS' },
  sigPosTop: { en: 'ON TOP', de: 'OBEN' },
  sigPosBottom: { en: 'BELOW', de: 'UNTEN' },
  sigOrder: { en: 'ARRANGEMENT', de: 'ANORDNUNG' },
  sigOrderHint: {
    en: 'edit text inline \u00b7 reorder with arrows',
    de: 'Text direkt bearbeiten \u00b7 mit Pfeilen sortieren'
  },
  sigPreview: { en: 'PREVIEW', de: 'VORSCHAU' },
  sigPreviewSub: {
    en: 'as recipients of {addr} will see it',
    de: 'so sehen es Empf\u00e4nger von {addr}'
  },
  sigPreviewBody: {
    en: '\u2026 I will get back to you on Thursday with the details.',
    de: '\u2026 ich melde mich Donnerstag mit den Details.'
  },
  sigImgHint: { en: 'click or drop an image', de: 'klicken oder Bild hineinziehen' },
  sigImgBorder: { en: 'BORDER', de: 'RAHMEN' },
  sigImgPadding: { en: 'PADDING', de: 'INNEN' },
  sigImgBackground: { en: 'BACKGROUND', de: 'HINTERGRUND' },
  sigImgBackgroundTransparent: { en: 'Transparent', de: 'Transparent' },
  // Kuratierte Swatches statt OS-Farbwähler (Design 3f)
  sigSwatchPaper: { en: 'Paper', de: 'Papier' },
  sigSwatchPastel: { en: 'Pastel {hex}', de: 'Pastell {hex}' },
  sigSwatchInk: { en: 'Ink', de: 'Tinte' },
  sigSwatchCustom: { en: 'Saved color {hex}', de: 'Gespeicherte Farbe {hex}' },
  sigImgFootnote: {
    en: 'WITH IMAGE THE MAIL IS SENT AS HTML \u00b7 WITHOUT IMAGE AS PLAIN TEXT',
    de: 'MIT BILD GEHT DIE MAIL ALS HTML RAUS \u00b7 OHNE BILD ALS REINER TEXT'
  },
  sigGreetingFootnote: {
    en: 'The closing line comes from your learned style, not from the signature.',
    de: 'Die Gru\u00dfformel kommt aus deinem gelernten Stil, nicht aus der Signatur.'
  },
  sigBlock_name: { en: 'NAME', de: 'NAME' },
  sigBlock_title: { en: 'TITLE', de: 'TITEL' },
  sigBlock_studio: { en: 'COMPANY', de: 'FIRMA' },
  sigBlock_phone: { en: 'PHONE', de: 'TELEFON' },
  sigBlock_website: { en: 'WEBSITE', de: 'WEBSITE' },
  sigBlock_address: { en: 'ADDRESS', de: 'ANSCHRIFT' },
  sigBlock_claim: { en: 'CLAIM', de: 'CLAIM' },
  sigBlock_rule: { en: 'DIVIDER', de: 'TRENNLINIE' },
  sigBlock_img: { en: 'IMAGE', de: 'BILD' },
  cmdFolderSpam: { en: 'Folder: Spam', de: 'Ordner: Spam' },
  cmdFolderSpamNote: { en: 'the owl pre-sorts', de: 'die Eule sortiert vor' },
  toName: { en: 'To: {name}', de: 'An: {name}' },
  quoteShow: { en: 'show earlier history', de: 'früheren Verlauf anzeigen' },
  quoteHide: { en: 'hide earlier history', de: 'früheren Verlauf ausblenden' },
  mailAttachmentOne: { en: '1 ATTACHMENT', de: '1 ANHANG' },
  mailAttachmentMany: { en: '{count} ATTACHMENTS', de: '{count} ANHÄNGE' },
  mailAttachmentsLoading: { en: 'LOADING ATTACHMENTS', de: 'ANHÄNGE WERDEN GELADEN' },
  mailAttachmentsTotal: { en: 'TOTAL {size}', de: 'GESAMT {size}' },
  mailAttachmentUnknown: { en: 'Unnamed attachment', de: 'Unbenannter Anhang' },
  mailAttachmentSave: { en: 'SAVE', de: 'SPEICHERN' },
  mailAttachmentSaving: { en: 'SAVING', de: 'WIRD GESPEICHERT' },
  mailAttachmentSaved: { en: 'SAVED', de: 'GESPEICHERT' },
  mailAttachmentRetry: { en: 'TRY AGAIN', de: 'ERNEUT' },
  mailAttachmentSaveAria: { en: 'Save attachment {filename}', de: 'Anhang {filename} speichern' },
  mailAttachmentSavedToast: { en: 'Saved: {filename}', de: 'Gespeichert: {filename}' },
  mailAttachmentSaveFailed: {
    en: 'Could not save {filename}',
    de: '{filename} konnte nicht gespeichert werden'
  },
  mailAttachmentTypePdf: { en: 'PDF DOCUMENT', de: 'PDF-DOKUMENT' },
  mailAttachmentTypeImage: { en: 'IMAGE', de: 'BILD' },
  mailAttachmentTypeDocument: { en: 'DOCUMENT', de: 'DOKUMENT' },
  mailAttachmentTypeSpreadsheet: { en: 'SPREADSHEET', de: 'TABELLE' },
  mailAttachmentTypePresentation: { en: 'PRESENTATION', de: 'PRÄSENTATION' },
  mailAttachmentTypeCalendar: { en: 'CALENDAR', de: 'KALENDER' },
  mailAttachmentTypeArchive: { en: 'ARCHIVE', de: 'ARCHIV' },
  mailAttachmentTypeAudio: { en: 'AUDIO', de: 'AUDIO' },
  mailAttachmentTypeVideo: { en: 'VIDEO', de: 'VIDEO' },
  mailAttachmentTypeText: { en: 'TEXT FILE', de: 'TEXTDATEI' },
  mailAttachmentTypeFile: { en: 'FILE', de: 'DATEI' },
  composeHead: { en: 'New message', de: 'Neue Nachricht' },
  composeSub: {
    en: 'THE OWL WRITES IN THIS ADDRESS’S VOICE',
    de: 'DIE EULE SCHREIBT IN DER STIMME DIESER ADRESSE'
  },
  composeToPh: { en: 'name or address…', de: 'Name oder Adresse…' },
  composeSubjectPh: { en: 'what is it about?', de: 'worum geht’s?' },
  composeDictationPolished: {
    en: '✓ DICTATION LIGHTLY POLISHED',
    de: '✓ DIKTAT LEICHT GEGLÄTTET'
  },
  composeIdeaDrafted: {
    en: '✓ DRAFTED FROM YOUR IDEA',
    de: '✓ AUS DEINER IDEE FORMULIERT'
  },
  composeFormatting: { en: 'formatting', de: 'Formatierung' },
  composeHideFormatting: { en: 'Hide formatting', de: 'Formatierung ausblenden' },
  composeBold: { en: 'Bold', de: 'Fett' },
  composeItalic: { en: 'Italic', de: 'Kursiv' },
  composeUnderline: { en: 'Underline', de: 'Unterstrichen' },
  composeFontSize: { en: 'Font size', de: 'Schriftgröße' },
  composeSizeSmall: { en: 'Small', de: 'Klein' },
  composeSizeNormal: { en: 'Normal', de: 'Normal' },
  composeSizeLarge: { en: 'Large', de: 'Groß' },
  composeLink: { en: 'link', de: 'Link' },
  composeApply: { en: 'Apply', de: 'Übernehmen' },
  composerListening: { en: 'RECORDING', de: 'AUFNAHME LÄUFT' },
  composerStopRecording: { en: 'STOP RECORDING', de: 'AUFNAHME STOPPEN' },
  composerNewPlaceholder: {
    en: 'Write your message, notes, or an instruction…',
    de: 'Schreib deine Nachricht, Stichpunkte oder eine Anweisung…'
  },
  composerReplyPlaceholder: {
    en: 'Write your reply, notes, or an instruction…',
    de: 'Schreib deine Antwort, Stichpunkte oder eine Anweisung…'
  },
  replyScopeLabel: { en: 'REPLY TO', de: 'ANTWORT AN' },
  replyAllToggle: { en: 'REPLY ALL', de: 'ALLEN ANTWORTEN' },
  replyAllPlus: { en: '+{n}', de: '+{n}' },
  replyExtraAria: {
    en: 'Add recipients (to/CC/BCC)',
    de: 'Weitere Empfänger hinzufügen (An/CC/BCC)'
  },
  replyExtraTo: { en: '+TO', de: '+AN' },
  replyDropRecipient: {
    en: 'Do not reply to {addr}',
    de: 'Nicht an {addr} antworten'
  },
  replyRestoreRecipients: {
    en: 'Restore the removed recipients',
    de: 'Entfernte Empfänger zurückholen'
  },
  replyNoRecipient: {
    en: 'nobody — add a recipient with +',
    de: 'niemand — Empfänger über + hinzufügen'
  },
  replyAllToggleAria: {
    en: 'reply to all — {n} more recipients',
    de: 'allen antworten — {n} weitere Empfänger'
  },
  sendToN: { en: 'SEND TO {n}', de: 'SENDEN AN {n}' },
  toastReplyAllAlone: {
    en: 'No other recipients — the reply goes to the sender.',
    de: 'Keine weiteren Empfänger — die Antwort geht an den Absender.'
  },
  composerTranscribing: { en: 'PROCESSING DICTATION', de: 'DIKTAT WIRD VERARBEITET' },
  composerKeepsText: { en: 'YOUR TEXT STAYS IN PLACE', de: 'DEIN TEXT BLEIBT ERHALTEN' },
  composerGenerating: { en: 'THE OWL IS WRITING', de: 'DIE EULE FORMULIERT' },
  composerNoRecording: {
    en: 'No usable recording was found. You can keep typing.',
    de: 'Keine brauchbare Aufnahme erkannt. Du kannst direkt weiterschreiben.'
  },
  composerGenerationError: {
    en: 'The owl did not return a draft. Your original text is still here.',
    de: 'Die Eule hat keinen Entwurf geliefert. Dein ursprünglicher Text ist noch da.'
  },
  composerDictationInserted: { en: '✓ DICTATION INSERTED', de: '✓ DIKTAT EINGEFÜGT' },
  composerGenerated: {
    en: '✓ FORMULATED FROM YOUR TEXT',
    de: '✓ AUS DEINEM TEXT FORMULIERT'
  },
  composerRetry: { en: 'TRY AGAIN', de: 'ERNEUT VERSUCHEN' },
  composerDismiss: { en: 'DISMISS', de: 'SCHLIESSEN' },
  composerRestoreOriginal: { en: 'RESTORE ORIGINAL', de: 'ORIGINAL WIEDERHERSTELLEN' },
  composerSendReply: { en: 'SEND REPLY', de: 'ANTWORT SENDEN' },
  composerSendMessage: { en: 'SEND MESSAGE', de: 'NACHRICHT SENDEN' },
  composerSending: { en: 'SENDING…', de: 'WIRD GESENDET…' },
  composerGenerate: { en: 'FORMULATE WITH OWL', de: 'MIT EULE FORMULIEREN' },
  composerDictate: { en: 'DICTATE', de: 'DIKTIEREN' },
  composerFormat: { en: 'FORMAT', de: 'FORMAT' },
  composerDiscard: { en: 'DISCARD DRAFT', de: 'ENTWURF VERWERFEN' },
  toastInvalidLink: {
    en: 'Please enter a valid web or email address',
    de: 'Bitte eine gültige Web- oder E-Mail-Adresse eingeben'
  },
  toastNoRecipient: { en: 'At least one recipient', de: 'Mindestens ein Empfänger nötig' },
  toastNoIdea: {
    en: 'Type or dictate the idea first — ⌘J turns it into the mail.',
    de: 'Erst die Idee tippen oder diktieren — ⌘J macht daraus die Mail.'
  },
  toggleListLabel: { en: 'show/hide list', de: 'Liste ein-/ausblenden' },
  toggleRailLabel: { en: 'show/hide the owl', de: 'Eule ein-/ausblenden' },
  loading: { en: 'loading…', de: 'lädt…' },

  // ── Rechtschreibprüfung ──
  followupRadarHead: { en: 'FOLLOW-UP RADAR', de: 'FOLLOW-UP-RADAR' },
  followupRadarSub: {
    en: 'when unanswered sent mail appears under WAITING',
    de: 'wann unbeantwortete gesendete Mails unter WARTET auftauchen'
  },
  followupDays: { en: '{n} days silent', de: '{n} Tage still' },
  followupFewer: { en: 'Fewer days', de: 'Weniger Tage' },
  followupMore: { en: 'More days', de: 'Mehr Tage' },
  followupWindowNote: {
    en: 'window 3–21 days · applies at the next scan',
    de: 'Fenster 3–21 Tage · greift beim nächsten Scan'
  },
  spellIgnore: { en: 'IGNORE', de: 'IGNORIEREN' },
  spellNoSuggestions: { en: 'no suggestions', de: 'keine Vorschläge' },

  // ── Technik-Seite: „Wie die Eule denkt" (Pipelines in Bildern) ──
  cmdTech: { en: 'How the owl thinks', de: 'Wie die Eule denkt' },
  cmdTechNote: { en: 'every pipeline, one picture', de: 'jede Pipeline ein Bild' },
  techHead: { en: 'How the owl thinks', de: 'Wie die Eule denkt' },
  techSub: {
    en: 'TEN PIPELINES, TEN PICTURES · NO MAGIC, JUST PLUMBING',
    de: 'ZEHN PIPELINES, ZEHN BILDER · KEINE MAGIE, NUR HANDWERK'
  },
  techLegendSolid: { en: 'SOLID — ON YOUR DEVICE', de: 'DURCHGEZOGEN — AUF DEINEM GERÄT' },
  techLegendDashed: {
    en: 'DASHED — API CALL VIA OPENROUTER',
    de: 'GESTRICHELT — API-CALL ÜBER OPENROUTER'
  },
  techLegendModel: { en: '✦ — A LANGUAGE MODEL', de: '✦ — EIN SPRACHMODELL' },
  techLegendNote: {
    en: 'Dashed lines only exist once you add an OpenRouter key — without one, the owl stays fully on paper.',
    de: 'Gestrichelte Linien gibt es erst mit deinem OpenRouter-Schlüssel — ohne bleibt die Eule ganz auf dem Papier.'
  },

  // 01 · Triage
  techTriageTitle: { en: 'Triage — every new mail', de: 'Triage — jede neue Mail' },
  techTriageIn: { en: 'NEW MAIL', de: 'NEUE MAIL' },
  techTriageQueue: { en: 'QUEUE', de: 'WARTESCHLANGE' },
  techTriageBudget: { en: 'BUDGET GUARD', de: 'BUDGET-WÄCHTER' },
  techTriageBudgetNote1: { en: 'DAY & MONTH', de: 'TAG & MONAT' },
  techTriageBudgetNote2: { en: 'CAPPED', de: 'GEDECKELT' },
  techTriageModel: { en: 'SCAN MODEL', de: 'SCAN-MODELL' },
  techTriageModelNote: { en: 'DEEPSEEK · YOUR PICK', de: 'DEEPSEEK · WÄHLBAR' },
  techTriageCard: { en: 'ANNOTATION', de: 'ANNOTATION' },
  techTriageRow1: { en: 'CATEGORY — WORK', de: 'KATEGORIE — ARBEIT' },
  techTriagePrio: { en: 'PRIORITY', de: 'PRIORITÄT' },
  techTriageGist: { en: '“The gist in one line.”', de: '„Der Kern in einer Zeile.“' },
  techTriageRow4: { en: 'REPLY? · TASKS · FOR ME?', de: 'ANTWORT? · AUFGABEN · AN MICH?' },
  techTriageSpam: {
    en: 'ONLY THE INBOX — SPAM IS NEVER READ',
    de: 'NUR DER POSTEINGANG — SPAM WIRD NIE GELESEN'
  },
  techTriageCap: {
    en: 'Every new inbox mail gets one cheap read: category, priority, the one-liner — and whether it needs you. A budget guard caps the daily and monthly spend; when the budget is spent, the queue simply waits.',
    de: 'Jede neue Mail im Posteingang bekommt genau eine günstige Lektüre: Kategorie, Priorität, der Ein-Zeiler — und ob sie dich braucht. Ein Budget-Wächter deckelt Tages- und Monatskosten; ist das Budget leer, wartet die Warteschlange einfach.'
  },

  // 02 · Adressat-Erkennung
  techAddrTitle: { en: 'Who is actually meant', de: 'Wer wirklich gemeint ist' },
  techAddrS1: { en: '1 · SALUTATION', de: '1 · ANREDE' },
  techAddrS1Sample: { en: '“Hi Tim,”', de: '„Hallo Tim,“' },
  techAddrMyName: { en: 'MY NAME', de: 'MEIN NAME' },
  techAddrForeign: { en: 'SOMEONE ELSE’S NAME', de: 'FREMDER NAME' },
  techAddrNoSal: { en: 'NO NAME · GROUP (“HI ALL”)', de: 'KEIN NAME · GRUPPE („HALLO ZUSAMMEN“)' },
  techAddrS2: { en: '2 · ENVELOPE', de: '2 · UMSCHLAG' },
  techAddrS2Sample: { en: 'TO · CC · NOT LISTED', de: 'AN · CC · NICHT ADRESSIERT' },
  techAddrCc: { en: 'CC / LIST ONLY', de: 'NUR CC / VERTEILER' },
  techAddrTo: { en: 'I AM IN “TO”', de: 'ICH STEHE IM AN' },
  techAddrS3: { en: '3 · MODEL VERDICT', de: '3 · MODELL-URTEIL' },
  techAddrS3Sample: { en: 'ADDRESSED_TO_ME', de: 'ADDRESSED_TO_ME' },
  techAddrYes: { en: 'YES', de: 'JA' },
  techAddrNo: { en: 'NO', de: 'NEIN' },
  techAddrCreate: { en: 'CREATE TASK', de: 'AUFGABE ANLEGEN' },
  techAddrNone: { en: 'NOTHING', de: 'NICHTS' },
  techAddrSuggest: { en: 'SUGGEST ONLY', de: 'NUR VORSCHLAG' },
  techAddrCap: {
    en: 'A task only appears when you are truly meant: a salutation naming you beats the envelope, the envelope beats the model. And when the model doubts, the owl merely suggests — it never creates in silence.',
    de: 'Eine Aufgabe entsteht nur, wenn wirklich du gemeint bist: Die Anrede mit deinem Namen schlägt den Umschlag, der Umschlag schlägt das Modell. Und zweifelt das Modell, schlägt die Eule nur vor — angelegt wird nie im Stillen.'
  },

  // 03 · Aufgaben-Sieb
  techSieveTitle: { en: 'The task sieve', de: 'Das Aufgaben-Sieb' },
  techSieveIn: { en: 'ACTION ITEMS FROM TRIAGE', de: 'ACTION-ITEMS AUS DER TRIAGE' },
  techSieve1: { en: 'AUTO-CREATE IS OFF', de: 'AUTO-ANLEGEN IST AUS' },
  techSieve2: { en: 'CATEGORY WITHOUT TASKS', de: 'KATEGORIE OHNE AUFGABEN' },
  techSieve2b: { en: 'NEWSLETTER · PROMO · ALERTS', de: 'NEWSLETTER · WERBUNG · INFOS' },
  techSieve3: { en: 'SECURITY MAIL', de: 'SICHERHEITS-MAIL' },
  techSieve3b: { en: 'LOGIN · 2FA · PASSWORD', de: 'LOGIN · 2FA · PASSWORT' },
  techSieve4: { en: 'NOT ADDRESSED TO ME', de: 'NICHT AN MICH GERICHTET' },
  techSieve4b: { en: 'CC · LIST · FOREIGN NAME', de: 'CC · VERTEILER · FREMDE ANREDE' },
  techSieve5: { en: 'WRITTEN BY MYSELF', de: 'SELBST GESCHRIEBEN' },
  techSieve6: { en: 'FORWARD WITHOUT A REQUEST', de: 'WEITERLEITUNG OHNE AUFTRAG' },
  techSieveSuggest: { en: 'IN DOUBT: SUGGEST ONLY', de: 'IM ZWEIFEL: NUR VORSCHLAG' },
  techSieveSuggestB: { en: 'SHOWN INSIDE THE MAIL', de: 'ERSCHEINT IN DER MAIL' },
  techSieveTask: { en: 'TASK', de: 'AUFGABE' },
  techSieveTaskNote: { en: 'MAX 5 + “REPLY” TASK', de: 'MAX. 5 + „ANTWORTEN“' },
  techSieveCap: {
    en: 'Six sieves, in exactly this order — whatever gets caught is dropped, and in doubt the owl only suggests. Only what falls through all six becomes a task on its own.',
    de: 'Sechs Siebe, genau in dieser Reihenfolge — was hängen bleibt, wird verworfen, und im Zweifel wird nur vorgeschlagen. Nur was durch alle sechs fällt, wird von selbst zur Aufgabe.'
  },

  // 04 · Semantische Suche
  techSearchTitle: { en: 'Search — text and meaning', de: 'Suche — Text und Bedeutung' },
  techSearchIn: { en: 'YOUR QUERY', de: 'DEINE SUCHE' },
  techSearchSample: { en: '“lease agreement”', de: '„mietvertrag“' },
  techSearchFts: { en: 'FULL TEXT — FTS5', de: 'VOLLTEXT — FTS5' },
  techSearchFtsNote: { en: 'BM25 RANKING', de: 'BM25-RANKING' },
  techSearchVec: { en: 'MEANING — VECTORS', de: 'BEDEUTUNG — VEKTOREN' },
  techSearchVecNote: { en: 'E5-SMALL · ON DEVICE', de: 'E5-SMALL · AUF DEM GERÄT' },
  techSearchFuse: { en: 'FUSION', de: 'FUSION' },
  techSearchFuseNote: { en: 'RRF', de: 'RRF' },
  techSearchHits: { en: 'HITS', de: 'TREFFER' },
  techSearchChip: { en: 'LOCAL · 0 TOKENS', de: 'LOKAL · 0 TOKENS' },
  techSearchCap: {
    en: 'Full text and meaning search in parallel; a rank fusion blends both lists. All of it runs on your device — the embedding model lives locally, costs no tokens, and its coverage shows in the owl’s footer.',
    de: 'Volltext und Bedeutung suchen parallel, eine Rang-Fusion mischt beide Listen. Alles läuft auf deinem Gerät — das Embedding-Modell wohnt lokal, kostet keine Tokens, und die Abdeckung steht unten in der Eulen-Ansicht.'
  },

  // 05 · Die Eule fragen
  techAskTitle: { en: 'Ask the owl', de: 'Die Eule fragen' },
  techAskQ: { en: 'YOUR QUESTION', de: 'DEINE FRAGE' },
  techAskExpand: { en: 'SEARCH TERMS', de: 'SUCHBEGRIFFE' },
  techAskLocal: { en: 'LOCAL SEARCH', de: 'LOKALE SUCHE' },
  techAskLocalNote: { en: 'VECTOR + FULL TEXT', de: 'VEKTOR + VOLLTEXT' },
  techAskSources: { en: 'SOURCES', de: 'QUELLEN' },
  techAskModel: { en: 'WRITING MODEL', de: 'SCHREIB-MODELL' },
  techAskModelNote: { en: 'DEFAULT CLAUDE · YOUR PICK', de: 'DEFAULT CLAUDE · WÄHLBAR' },
  techAskAnswer: { en: 'STREAMED ANSWER', de: 'GESTREAMTE ANTWORT' },
  techAskStore: { en: 'STAYS IN SQLITE', de: 'BLEIBT IN SQLITE' },
  techAskStoreNote: { en: 'YOUR LOCAL DATABASE', de: 'DEINE LOKALE DATENBANK' },
  techAskCap: {
    en: 'A question first searches your mail locally; only the question and the found excerpts travel to the model. The answer streams in with [n] citations — the conversation itself stays in your local database.',
    de: 'Eine Frage sucht zuerst lokal in deiner Post; nur die Frage und die Fundstellen reisen zum Modell. Die Antwort kommt gestreamt mit [n]-Zitaten — das Gespräch selbst bleibt in deiner lokalen Datenbank.'
  },

  // 06 · Entwürfe & Stimme
  techVoiceTitle: { en: 'Drafts & your voice', de: 'Entwürfe & deine Stimme' },
  techVoiceSent1: { en: 'SENT', de: 'GESENDETE' },
  techVoiceSent2: { en: 'MAILS', de: 'MAILS' },
  techVoiceProfile: { en: 'STYLE PROFILE', de: 'STILPROFIL' },
  techVoiceProfileNote: { en: 'ONE PER ADDRESS', de: 'EINES PRO ADRESSE' },
  techVoiceThread1: { en: 'THREAD WITH', de: 'VERLAUF MIT' },
  techVoiceThread2: { en: 'THIS PERSON', de: 'DER PERSON' },
  techVoiceFormal: { en: 'DU / SIE', de: 'DU / SIE' },
  techVoiceFormalNote1: { en: 'DETERMINISTIC', de: 'DETERMINISTISCH' },
  techVoiceFormalNote2: { en: 'BEATS THE PROFILE', de: 'SCHLÄGT DAS PROFIL' },
  techVoiceMic: { en: 'DICTATION', de: 'DIKTAT' },
  techVoiceStt: { en: 'TRANSCRIPTION', de: 'TRANSKRIPTION' },
  techVoiceModel: { en: 'DRAFT MODEL', de: 'ENTWURFS-MODELL' },
  techVoiceDraft: { en: 'DRAFT', de: 'ENTWURF' },
  techVoiceDraftNote: { en: 'IN YOUR VOICE', de: 'IN DEINER STIMME' },
  techVoiceSend: { en: 'YOU PRESS SEND', de: 'DU DRÜCKST SENDEN' },
  techVoiceSendNote: { en: 'ALWAYS BY HAND', de: 'IMMER VON HAND' },
  techVoiceCap: {
    en: 'The owl learns your voice per address from mails you sent; Du or Sie follows the actual thread with that person — deterministically, overriding the profile. And nothing ever sends itself: the last click is always yours.',
    de: 'Deine Stimme lernt die Eule pro Adresse aus deinen gesendeten Mails; Du oder Sie folgt dem echten Verlauf mit der Person — deterministisch, vor dem Profil. Und gesendet wird nie von allein: Der letzte Klick gehört dir.'
  },

  // 07 · Rechtschreibprüfung
  techSpellTitle: { en: 'Spelling — offline, honest', de: 'Rechtschreibung — offline, ehrlich' },
  techSpellSample: { en: 'definately', de: 'Rechtschreibpürfung' },
  techSpellEngine: { en: 'HUNSPELL · WASM', de: 'HUNSPELL · WASM' },
  techSpellDictNote: { en: 'BUNDLED LOCALLY', de: 'LOKAL GEBÜNDELT' },
  techSpellSuggest: { en: 'SUGGESTIONS', de: 'VORSCHLÄGE' },
  techSpellFix: { en: 'definitely', de: 'Rechtschreibprüfung' },
  techSpellIgnoreNote: { en: 'IGNORE — THIS SESSION ONLY', de: 'IGNORIEREN — NUR DIESE SITZUNG' },
  techSpellChip: { en: 'NO CLOUD', de: 'KEINE CLOUD' },
  techSpellChipNote: { en: 'REPLACES THE MACOS CHECKER', de: 'ERSETZT DIE MACOS-PRÜFUNG' },
  techSpellCap: {
    en: 'A real Hunspell runs as WebAssembly inside the app; German and English dictionaries ship in the box. No word ever leaves your machine — the built-in macOS checker is deliberately switched off.',
    de: 'Ein echtes Hunspell läuft als WebAssembly in der App, deutsche und englische Wörterbücher liegen gleich mit im Paket. Kein Wort verlässt je deinen Rechner — die macOS-Prüfung ist bewusst abgeschaltet.'
  },

  // 08 · Regeln
  techRulesTitle: {
    en: 'Rules — drafted once, applied forever',
    de: 'Regeln — einmal entworfen, immer angewandt'
  },
  techRulesQuote1: { en: '“Archive Hetzner invoices,', de: '„Hetzner-Rechnungen ablegen,' },
  techRulesQuote2: { en: 'make a task.”', de: 'Aufgabe anlegen.“' },
  techRulesDraft: { en: 'DRAFTS THE RULE', de: 'ENTWIRFT DIE REGEL' },
  techRulesJson: { en: 'RULE JSON', de: 'REGEL-JSON' },
  techRulesJsonIf: {
    en: 'IF: SENDER · SUBJECT · CATEGORY',
    de: 'WENN: ABSENDER · BETREFF · KATEGORIE'
  },
  techRulesJsonThen: {
    en: 'THEN: ARCHIVE · TASK · FLAG',
    de: 'DANN: ABLEGEN · AUFGABE · MARKIEREN'
  },
  techRulesLaneA: { en: 'ONCE — WHEN YOU DESCRIBE IT', de: 'EINMAL — WENN DU SIE BESCHREIBST' },
  techRulesLaneB: {
    en: 'EVERY MAIL — DETERMINISTIC · 0 AI CALLS',
    de: 'JEDE MAIL — DETERMINISTISCH · 0 KI-CALLS'
  },
  techRulesMatch: { en: 'DOES IT MATCH?', de: 'PASST DIE REGEL?' },
  techRulesMatchNote: { en: 'PLAIN COMPARISONS', de: 'REINE VERGLEICHE' },
  techRulesAct1: { en: 'ARCHIVE', de: 'ABLEGEN' },
  techRulesAct2: { en: 'TASK', de: 'AUFGABE' },
  techRulesAct3: { en: 'CATEGORY', de: 'KATEGORIE' },
  techRulesCap: {
    en: 'The model only drafts the rule JSON from your description — one single time. Applying it happens deterministically on every mail, without any further AI calls.',
    de: 'Das Modell entwirft nur das Regel-JSON aus deiner Beschreibung — ein einziges Mal. Angewendet wird die Regel deterministisch bei jeder Mail, ganz ohne weitere KI-Calls.'
  },

  // 09 · Follow-up-Radar
  techRadarTitle: { en: 'The follow-up radar', de: 'Das Follow-up-Radar' },
  techRadarSent1: { en: 'YOUR SENT', de: 'GESENDETE' },
  techRadarSent2: { en: 'MAIL', de: 'MAIL' },
  techRadarDays: { en: '3 DAYS OF SILENCE', de: '3 TAGE STILL' },
  techRadarDaysNote1: { en: 'THRESHOLD ADJUSTABLE', de: 'SCHWELLE EINSTELLBAR' },
  techRadarDaysNote2: { en: 'WINDOW 3–21 DAYS', de: 'FENSTER 3–21 TAGE' },
  techRadarCheck: { en: 'EXPECTS A REPLY?', de: 'ERWARTET ANTWORT?' },
  techRadarCheckNote: { en: 'THE CHEAP SCAN MODEL', de: 'DAS GÜNSTIGE SCAN-MODELL' },
  techRadarList: { en: 'SHOWS UP IN “WAITING”', de: 'ERSCHEINT UNTER „WARTET“' },
  techRadarOpen: { en: 'WHEN YOU OPEN IT:', de: 'ÖFFNEST DU DEN EINTRAG:' },
  techRadarNudge: { en: 'NUDGE DRAFT', de: 'STUPSER-ENTWURF' },
  techRadarVoice: { en: 'IN YOUR VOICE', de: 'IN DEINER STIMME' },
  techRadarVoiceNote: { en: 'PROFILE + DU/SIE', de: 'PROFIL + DU/SIE' },
  techRadarSend: { en: 'YOU SEND IT', de: 'DU SENDEST' },
  techRadarCap: {
    en: 'The radar finds your sent mails that stayed unanswered, counts the days, and asks a cheap model whether a reply is even expected. The nudge is only a draft in your voice — sending it stays your move.',
    de: 'Das Radar findet deine gesendeten Mails, die unbeantwortet blieben, zählt die Tage und fragt ein günstiges Modell, ob überhaupt eine Antwort aussteht. Der Stupser ist nur ein Entwurf in deiner Stimme — abgeschickt wird er von dir.'
  },

  // 10 · Datenhaltung
  techDataTitle: { en: 'Where your data lives', de: 'Wo deine Daten wohnen' },
  techDataMac: { en: 'YOUR MAC', de: 'DEIN MAC' },
  techDataDb: { en: 'NOCTUA.SQLITE', de: 'NOCTUA.SQLITE' },
  techDataDbRow1: { en: 'MAILS · TASKS · CHATS', de: 'MAILS · AUFGABEN · GESPRÄCHE' },
  techDataDbRow2: { en: 'SEARCH INDEX · RULES', de: 'SUCH-INDEX · REGELN' },
  techDataVault: { en: 'VAULT', de: 'VAULT' },
  techDataVaultRow1: { en: 'SAFESTORAGE · KEYCHAIN', de: 'SAFESTORAGE · SCHLÜSSELBUND' },
  techDataVaultRow2: { en: 'PASSWORDS · TOKENS · API KEY', de: 'PASSWÖRTER · TOKEN · API-KEY' },
  techDataOnboard: { en: 'ON BOARD:', de: 'AN BORD:' },
  techDataChip1: { en: 'E5 EMBEDDINGS', de: 'E5-EMBEDDINGS' },
  techDataChip2: { en: 'HUNSPELL DE+EN', de: 'HUNSPELL DE+EN' },
  techDataChip3: { en: 'SQLITE-VEC', de: 'SQLITE-VEC' },
  techDataOr: { en: 'OPENROUTER', de: 'OPENROUTER' },
  techDataOrNote: { en: 'LLM CALLS ONLY', de: 'NUR LLM-CALLS' },
  techDataGh: { en: 'GITHUB RELEASES', de: 'GITHUB RELEASES' },
  techDataGhNote: { en: 'UPDATE CHECK · ANONYMOUS', de: 'UPDATE-CHECK · ANONYM' },
  techDataPixels: { en: 'TRACKING PIXELS', de: 'TRACKING-PIXEL' },
  techDataBlocked: { en: 'BLOCKED BY DEFAULT', de: 'STANDARDMÄSSIG BLOCKIERT' },
  techDataCap: {
    en: 'Everything lives in one local SQLite file; credentials sit safeStorage-encrypted in a Keychain-backed vault. Outbound, only three things talk: your mail servers, the LLM calls via OpenRouter — and a quiet, anonymous release check on GitHub.',
    de: 'Alles wohnt in einer lokalen SQLite-Datei; Zugangsdaten liegen safeStorage-verschlüsselt im Schlüsselbund-gestützten Vault. Nach draußen reden nur drei Dinge: deine Mailserver, die LLM-Calls über OpenRouter — und ein stiller, anonymer Update-Check bei GitHub.'
  }
} as const

export type StringKey = keyof typeof table
export const STRINGS: Record<StringKey, { en: string; de: string }> = table
