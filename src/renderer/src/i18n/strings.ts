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
  toastSendingIn: { en: 'Sending as {addr} in {n}s', de: 'Wird in {n} s als {addr} gesendet' },
  toastSending: { en: 'Sending…', de: 'Wird gesendet…' },
  toastSentAs: { en: 'Sent as {addr}', de: 'Gesendet als {addr}' },
  toastSendFailed: {
    en: 'Send failed — your draft is safe.',
    de: 'Senden fehlgeschlagen – dein Entwurf ist gesichert.'
  },
  toastSendUnknown: {
    en: 'Sending was interrupted — it may still have gone through. Check your Sent folder.',
    de: 'Senden unterbrochen – die E-Mail wurde möglicherweise trotzdem gesendet. Sieh im Ordner „Gesendet“ nach.'
  },
  toastOpenDraft: { en: 'Open draft', de: 'Entwurf öffnen' },

  // ── Op-Queue: nicht ausführbare Aktionen (Dead-Letter) ──
  opsDeadAttempts: {
    en: '{n} action(s) could not be synced to the server and were dropped.',
    de: '{n} Aktion(en) konnten nicht mit dem Server abgeglichen werden und wurden verworfen.'
  },
  opsDeadUidvalidity: {
    en: '{n} action(s) were dropped because the server folder was reset.',
    de: '{n} Aktion(en) wurden verworfen, weil der Ordner auf dem Server zurückgesetzt wurde.'
  },
  opsDeadNoTarget: {
    en: '{n} action(s) failed: the Archive/Trash folder was not found on the server.',
    de: '{n} Aktion(en) fehlgeschlagen: Archiv- oder Papierkorb-Ordner auf dem Server nicht gefunden.'
  },
  opsDeadFolderGone: {
    en: '{n} action(s) were dropped because the folder no longer exists.',
    de: '{n} Aktion(en) wurden verworfen, weil der Ordner nicht mehr existiert.'
  },

  // ── Kalender-Konten (CalDAV, Phase 2.1) ──
  taskSyncHead: { en: 'SYNC TASKS (CALDAV)', de: 'AUFGABEN SYNCHRONISIEREN (CALDAV)' },
  taskSyncNote: {
    en: 'Accepted tasks and one calendar’s task list stay in sync both ways. Owl suggestions you haven’t accepted are never uploaded; dismissing or deleting a task removes it on the server too.',
    de: 'Übernommene Aufgaben und die Aufgabenliste eines Kalenders werden in beide Richtungen abgeglichen. Nicht übernommene Vorschläge der Eule werden nie hochgeladen. Wenn du eine Aufgabe verwirfst oder löschst, verschwindet sie auch auf dem Server.'
  },
  taskSyncOff: { en: 'Off', de: 'Aus' },
  taskSyncPending: { en: 'Waiting to sync', de: 'Wartet auf Abgleich' },
  taskSyncSynced: { en: 'In sync with CalDAV', de: 'Mit CalDAV abgeglichen' },
  taskSyncConflict: {
    en: 'Conflict — the server version was kept',
    de: 'Konflikt – die Version vom Server wurde behalten'
  },
  calHead: { en: 'CALENDARS (CALDAV)', de: 'KALENDER (CALDAV)' },
  calNote: {
    en: 'Nextcloud, mailbox.org, Fastmail, Posteo, iCloud (app password) and other CalDAV servers. Sign-in works over HTTPS only.',
    de: 'Nextcloud, mailbox.org, Fastmail, Posteo, iCloud (App-Passwort) und andere CalDAV-Server. Die Anmeldung funktioniert nur über HTTPS.'
  },
  calAdd: { en: '+ ADD CALENDAR', de: '+ KALENDER HINZUFÜGEN' },
  calEmpty: {
    en: 'No calendar connected yet.',
    de: 'Noch kein Kalender verbunden.'
  },
  calFromMail: {
    en: 'Use an email account as a template…',
    de: 'E-Mail-Konto als Vorlage verwenden…'
  },
  calNamePh: { en: 'name, e.g. Nextcloud', de: 'Name, z. B. Nextcloud' },
  calServerPh: {
    en: 'server URL, domain or email address',
    de: 'Server-URL, Domain oder E-Mail-Adresse'
  },
  calUserPh: { en: 'username', de: 'Benutzername' },
  calPassPh: { en: 'password / app password', de: 'Passwort / App-Passwort' },
  calReusePassword: {
    en: 'Use the password of the email account (stays in the vault, stored separately)',
    de: 'Passwort des E-Mail-Kontos übernehmen (bleibt im Tresor, wird separat gespeichert)'
  },
  calTest: { en: 'TEST', de: 'TESTEN' },
  calHttpsNote: { en: 'https:// only', de: 'nur https://' },
  calFound: {
    en: 'Found {n} calendar(s) on {host}',
    de: '{n} Kalender auf {host} gefunden'
  },
  calScheduling: { en: 'server-side invitations', de: 'Einladungen über den Server' },
  calConnected: {
    en: 'Calendar connected ({n} calendars)',
    de: 'Kalender verbunden ({n} Kalender)'
  },
  calTestOk: { en: 'Connection OK — {n} calendars', de: 'Verbindung OK – {n} Kalender' },
  calRefresh: { en: 'SYNC NOW', de: 'JETZT ABGLEICHEN' },
  calRemove: { en: 'DISCONNECT', de: 'TRENNEN' },
  calRemoveConfirm: { en: 'YES, DISCONNECT', de: 'JA, TRENNEN' },
  calSyncing: { en: 'syncing···', de: 'gleicht ab···' },
  calSynced: { en: 'synced {time}', de: 'abgeglichen {time}' },
  calPending: { en: '{n} waiting to upload', de: '{n} warten auf den Upload' },
  calDead: { en: '{n} not applied', de: '{n} nicht übernommen' },
  cardSync: { en: 'Sync contacts (CardDAV)', de: 'Kontakte synchronisieren (CardDAV)' },
  cardNote: {
    en: 'Read-only: address books feed recipient suggestions. Edit contacts in Nextcloud.',
    de: 'Nur Lesezugriff: Adressbücher liefern die Vorschläge für Empfänger. Kontakte bearbeitest du z. B. in Nextcloud.'
  },
  cardCount: { en: '{n} contacts', de: '{n} Kontakte' },
  cardSynced: { en: 'contacts synced {time}', de: 'Kontakte abgeglichen {time}' },
  cardOn: { en: 'on', de: 'an' },
  cardOff: { en: 'off', de: 'aus' },
  calVisible: { en: 'visible', de: 'sichtbar' },
  calHidden: { en: 'hidden', de: 'ausgeblendet' },
  calReadOnly: { en: 'READ-ONLY', de: 'NUR LESEN' },
  calConflictConflict: {
    en: 'Calendar: “{title}” was changed on the server meanwhile — the server version was kept, your edit was not applied.',
    de: 'Kalender: „{title}“ wurde zwischenzeitlich auf dem Server geändert – die Serverversion bleibt erhalten, deine Änderung wurde nicht übernommen.'
  },
  calConflictGone: {
    en: 'Calendar: “{title}” was deleted on the server — your edit was not applied.',
    de: 'Kalender: „{title}“ wurde auf dem Server gelöscht – deine Änderung wurde nicht übernommen.'
  },
  calConflictForbidden: {
    en: 'Calendar: the server refused your change to “{title}”.',
    de: 'Kalender: Der Server hat deine Änderung an „{title}“ abgelehnt.'
  },
  calConflictAttempts: {
    en: 'Calendar: “{title}” could not be uploaded and was reverted.',
    de: 'Kalender: „{title}“ konnte nicht hochgeladen werden und wurde zurückgesetzt.'
  },

  // ── Kalenderansicht (Phase 2.2) ──
  navCalendar: { en: 'CALENDAR', de: 'KALENDER' },
  cmdGoCalendar: { en: 'Go to Calendar', de: 'Zum Kalender' },
  helpCalView: {
    en: 'calendar: day · week · month · today',
    de: 'Kalender: Tag · Woche · Monat · Heute'
  },
  helpCalMove: { en: 'calendar: previous / next period', de: 'Kalender: Zeitraum zurück / vor' },
  helpCalEvent: {
    en: 'calendar: new · open · delete event',
    de: 'Kalender: Termin neu · öffnen · löschen'
  },
  railAgendaHead: { en: 'TODAY', de: 'HEUTE' },
  railAgendaArrow: { en: 'calendar →', de: 'Kalender →' },
  railAgendaNone: { en: 'Nothing more on the calendar today.', de: 'Heute steht nichts mehr an.' },
  cvTomorrow: { en: 'TOMORROW', de: 'MORGEN' },
  cvMore: { en: '+{n} more', de: '+{n} weitere' },
  cvKeyView: { en: 'view', de: 'Ansicht' },
  cvKeyToday: { en: 'today', de: 'heute' },
  cvKeyNew: { en: 'new', de: 'neu' },
  cvRecurring: { en: 'Recurring event', de: 'Serientermin' },
  cvPendingTip: { en: 'Not synced to the server yet', de: 'Noch nicht mit dem Server abgeglichen' },
  cvPending: { en: 'NOT SYNCED YET', de: 'NICHT ABGEGLICHEN' },
  cvNoTitle: { en: '(No title)', de: '(Ohne Titel)' },
  cvAllDayShort: { en: 'ALL DAY', de: 'GANZTÄGIG' },
  cvAllDay: { en: 'All day', de: 'Ganztägig' },
  cvNewAllDayOn: { en: 'New all-day event on {day}', de: 'Neuer ganztägiger Termin am {day}' },
  cvNoAccount: { en: 'No calendar connected yet.', de: 'Noch kein Kalender verbunden.' },
  cvNoAccountSub: {
    en: 'Connect a CalDAV calendar — Nextcloud, Fastmail, iCloud …',
    de: 'Verbinde einen CalDAV-Kalender – Nextcloud, Fastmail, iCloud …'
  },
  cvOpenSettings: {
    en: 'SET UP IN SETTINGS → ACCOUNTS',
    de: 'IN DEN EINSTELLUNGEN → KONTEN EINRICHTEN'
  },
  cvNoWritable: {
    en: 'No writable calendar available.',
    de: 'Kein Kalender mit Schreibzugriff vorhanden.'
  },
  cvNoCalendars: {
    en: 'No calendars yet — they appear after the first sync.',
    de: 'Noch keine Kalender – sie erscheinen nach dem ersten Abgleich.'
  },
  cvPrev: { en: 'Previous', de: 'Zurück' },
  cvNext: { en: 'Next', de: 'Weiter' },
  cvToday: { en: 'TODAY', de: 'HEUTE' },
  cvViewSwitch: { en: 'Calendar view', de: 'Kalenderansicht' },
  cvDay: { en: 'DAY', de: 'TAG' },
  cvWeek: { en: 'WEEK', de: 'WOCHE' },
  cvMonth: { en: 'MONTH', de: 'MONAT' },
  cvNew: { en: '+ NEW', de: '+ NEU' },
  cvHead: { en: 'CALENDAR', de: 'KALENDER' },
  cvCalendars: { en: 'CALENDARS', de: 'KALENDER' },
  cvPrevMonth: { en: 'Previous month', de: 'Vorheriger Monat' },
  cvNextMonth: { en: 'Next month', de: 'Nächster Monat' },
  cvMiniLabel: { en: 'Month overview', de: 'Monatsübersicht' },
  cvColor: { en: 'Color', de: 'Farbe' },
  cvColorFor: { en: 'Color of {name}', de: 'Farbe von {name}' },
  cvColorDefault: { en: 'DEFAULT', de: 'STANDARD' },
  cvQuickTitle: { en: 'NEW EVENT', de: 'NEUER TERMIN' },
  cvTitle: { en: 'Title', de: 'Titel' },
  cvTitlePh: { en: 'Add a title', de: 'Titel hinzufügen' },
  cvSave: { en: 'SAVE', de: 'SPEICHERN' },
  cvMoreOptions: { en: 'MORE …', de: 'MEHR …' },
  cvSaveFailed: {
    en: 'Could not save the event: {err}',
    de: 'Der Termin konnte nicht gespeichert werden: {err}'
  },
  cvDeleteFailed: {
    en: 'Could not delete the event: {err}',
    de: 'Der Termin konnte nicht gelöscht werden: {err}'
  },
  cvErrEnd: { en: 'The end must be after the start.', de: 'Das Ende muss nach dem Beginn liegen.' },
  cvErrUntil: {
    en: 'The end of the repeat must not be before the start.',
    de: 'Das Ende der Wiederholung darf nicht vor dem Beginn liegen.'
  },
  cvErrTime: {
    en: 'Please enter valid dates and times (HH:mm).',
    de: 'Bitte gib gültige Daten und Uhrzeiten (HH:mm) ein.'
  },
  cvEditorNew: { en: 'NEW EVENT', de: 'NEUER TERMIN' },
  cvEditorEdit: { en: 'EVENT', de: 'TERMIN' },
  cvClose: { en: 'CLOSE', de: 'SCHLIESSEN' },
  cvCalendar: { en: 'Calendar', de: 'Kalender' },
  cvCalendarFixed: {
    en: 'An existing event cannot be moved to another calendar.',
    de: 'Ein vorhandener Termin kann nicht in einen anderen Kalender verschoben werden.'
  },
  cvWhen: { en: 'WHEN', de: 'WANN' },
  cvFrom: { en: 'FROM', de: 'VON' },
  cvTo: { en: 'TO', de: 'BIS' },
  cvFromTime: { en: 'Start time', de: 'Startzeit' },
  cvToTime: { en: 'End time', de: 'Endzeit' },
  cvTimezone: { en: 'ZONE', de: 'ZONE' },
  cvTimezoneShow: { en: 'TIME ZONE …', de: 'ZEITZONE …' },
  cvTimezoneFloating: { en: 'Floating (no time zone)', de: 'Ohne Zeitzone (gleitend)' },
  cvRepeat: { en: 'REPEAT', de: 'WIEDERHOLUNG' },
  cvRecNone: { en: 'Does not repeat', de: 'Keine Wiederholung' },
  cvRecDaily: { en: 'Daily', de: 'Täglich' },
  cvRecWeekly: { en: 'Weekly', de: 'Wöchentlich' },
  cvRecMonthly: { en: 'Monthly', de: 'Monatlich' },
  cvRecYearly: { en: 'Yearly', de: 'Jährlich' },
  cvEvery: { en: 'every', de: 'alle' },
  cvUnitDay: { en: 'day(s)', de: 'Tag(e)' },
  cvUnitWeek: { en: 'week(s)', de: 'Woche(n)' },
  cvUnitMonth: { en: 'month(s)', de: 'Monat(e)' },
  cvUnitYear: { en: 'year(s)', de: 'Jahr(e)' },
  cvOnDays: { en: 'On weekdays', de: 'An Wochentagen' },
  cvRecEnds: { en: 'Repeat ends', de: 'Wiederholung endet' },
  cvEndNever: { en: 'never', de: 'nie' },
  cvEndUntil: { en: 'on a date', de: 'an einem Datum' },
  cvEndCount: { en: 'after n times', de: 'nach n Terminen' },
  cvRecCustom: {
    en: 'Custom repeat rule (kept as is):',
    de: 'Eigene Wiederholungsregel (bleibt unverändert):'
  },
  cvRecReplace: { en: 'REPLACE WITH A SIMPLE RULE', de: 'DURCH EINFACHE REGEL ERSETZEN' },
  cvAlarm: { en: 'REMINDER', de: 'ERINNERUNG' },
  cvAlarmNone: { en: 'None', de: 'Keine' },
  cvAlarmAtStart: { en: 'At start', de: 'Zu Beginn' },
  cvAlarm5: { en: '5 minutes before', de: '5 Minuten vorher' },
  cvAlarm10: { en: '10 minutes before', de: '10 Minuten vorher' },
  cvAlarm15: { en: '15 minutes before', de: '15 Minuten vorher' },
  cvAlarm30: { en: '30 minutes before', de: '30 Minuten vorher' },
  cvAlarm60: { en: '1 hour before', de: '1 Stunde vorher' },
  cvAlarm1440: { en: '1 day before', de: '1 Tag vorher' },
  cvAlarmCustom: { en: 'Custom ({n}) — kept', de: 'Eigene ({n}) – bleibt erhalten' },
  cvShowAs: { en: 'SHOW AS', de: 'ANZEIGEN ALS' },
  cvBusy: { en: 'Busy', de: 'Beschäftigt' },
  cvFree: { en: 'Free', de: 'Frei' },
  cvLocation: { en: 'LOCATION', de: 'ORT' },
  cvDescription: { en: 'NOTES', de: 'NOTIZEN' },
  cvAttendees: { en: 'ATTENDEES', de: 'TEILNEHMENDE' },
  cvAttendeeAddPh: {
    en: 'Add attendee: name or address',
    de: 'Teilnehmende hinzufügen: Name oder Adresse'
  },
  cvAttendeeRemove: { en: 'Remove {addr}', de: '{addr} entfernen' },
  cvAttendeeRole: { en: 'Role of {addr}', de: 'Rolle von {addr}' },
  cvRoleReq: { en: 'required', de: 'erforderlich' },
  cvRoleOpt: { en: 'optional', de: 'optional' },
  cvRoleOther: { en: 'observer', de: 'zur Info' },
  cvYou: { en: 'you', de: 'du' },
  cvPartNew: { en: 'new', de: 'neu' },
  cvOrganizerOnly: {
    en: 'Only the organizer can change attendees.',
    de: 'Nur der Organisator kann Teilnehmende ändern.'
  },
  cvNotify: {
    en: 'Send invitations and updates to attendees',
    de: 'Einladungen und Änderungen an Teilnehmende senden'
  },
  cvNotifyDelete: {
    en: 'Notify attendees of the cancellation',
    de: 'Teilnehmende über die Absage informieren'
  },
  cvNotifyServer: {
    en: 'Your calendar server sends the invitations.',
    de: 'Dein Kalenderserver verschickt die Einladungen.'
  },
  cvDiffAdded: { en: '{n} new invitation(s)', de: '{n} neue Einladung(en)' },
  cvDiffRemoved: { en: '{n} cancellation(s)', de: '{n} Absage(n)' },
  cvRsvpHead: { en: 'YOUR RESPONSE', de: 'DEINE ANTWORT' },
  cvRsvpYes: { en: 'Accept', de: 'Zusagen' },
  cvRsvpMaybe: { en: 'Tentative', de: 'Mit Vorbehalt' },
  cvRsvpNo: { en: 'Decline', de: 'Absagen' },
  cvRsvpFailed: {
    en: 'Could not send the reply: {err}',
    de: 'Die Antwort konnte nicht gesendet werden: {err}'
  },
  cvRsvpSent: { en: 'Reply sent', de: 'Antwort gesendet' },
  cvFbHead: { en: 'AVAILABILITY 08–20', de: 'VERFÜGBARKEIT 08–20' },
  cvFbUnavailable: { en: 'no information', de: 'keine Angaben' },
  cvFbLoading: { en: 'loading…', de: 'lädt…' },
  cvFbNext: { en: 'Next free slot for everyone', de: 'Nächste freie Zeit für alle' },
  cvFbNone: {
    en: 'No common free slot in the next 10 working days.',
    de: 'In den nächsten 10 Arbeitstagen gibt es keine gemeinsame freie Zeit.'
  },
  cvFbUnknown: {
    en: 'Not considered (no availability information): {n}',
    de: 'Nicht berücksichtigt (keine Angaben): {n}'
  },
  cvFbFailed: {
    en: 'Availability could not be loaded.',
    de: 'Die Verfügbarkeit konnte nicht abgerufen werden.'
  },
  cvFbTentative: { en: 'tentative', de: 'vorläufig' },
  cvFbThisEvent: { en: 'this event', de: 'dieser Termin' },
  cvOrganizer: { en: 'ORGANIZER', de: 'ORGANISATOR' },
  cvPartAccepted: { en: 'accepted', de: 'zugesagt' },
  cvPartDeclined: { en: 'declined', de: 'abgesagt' },
  cvPartTentative: { en: 'tentative', de: 'mit Vorbehalt' },
  cvPartNeeds: { en: 'no reply', de: 'offen' },
  cvPartDelegated: { en: 'delegated', de: 'delegiert' },
  cvDelete: { en: 'DELETE', de: 'LÖSCHEN' },
  cvDeleteConfirm: { en: 'Delete this event?', de: 'Diesen Termin löschen?' },
  cvDeleteTitle: { en: 'DELETE EVENT', de: 'TERMIN LÖSCHEN' },
  cvDeleteHasAttendees: {
    en: 'This event has {n} attendee(s).',
    de: 'Dieser Termin hat {n} Teilnehmende.'
  },
  cvScopeEditHead: {
    en: 'RECURRING EVENT — APPLY CHANGE TO',
    de: 'SERIENTERMIN – ÄNDERUNG GILT FÜR'
  },
  cvScopeDeleteHead: { en: 'RECURRING EVENT — DELETE', de: 'SERIENTERMIN – LÖSCHEN' },
  cvScopeThis: { en: 'Only this event', de: 'Nur diesen Termin' },
  cvScopeFollowing: { en: 'This and following events', de: 'Diesen und alle folgenden' },
  cvScopeAll: { en: 'All events', de: 'Alle Termine' },
  cvLoading: { en: 'Loading …', de: 'Lädt…' },
  cvLoadFailed: {
    en: 'The event could not be loaded.',
    de: 'Der Termin konnte nicht geladen werden.'
  },

  // ── Update-Hinweis ──
  updateAvailable: { en: 'Version {v} is available', de: 'Version {v} ist verfügbar' },
  updateDownload: { en: 'Download', de: 'Herunterladen' },

  // ── Kategorie-Override (Taste l, Design 3d) ──
  overrideTitle: { en: 'Set category', de: 'Kategorie festlegen' },
  overrideReset: { en: 'Let the owl decide again', de: 'Die Eule wieder entscheiden lassen' },
  overrideFooterSet: { en: '1–7 / 0 SET', de: '1–7 / 0 WÄHLEN' },
  overrideFooterClose: { en: 'ESC CLOSE', de: 'ESC SCHLIESSEN' },
  catPersonal: { en: 'Personal', de: 'Persönlich' },
  catWork: { en: 'Work', de: 'Arbeit' },
  catNewsletter: { en: 'Newsletter', de: 'Newsletter' },
  catPromotions: { en: 'Promotions', de: 'Werbung' },
  catNotifications: { en: 'Notification', de: 'Benachrichtigung' },
  catTransactional: { en: 'Transaction', de: 'Belege' },
  catOther: { en: 'Other', de: 'Sonstiges' },

  // ── Remote-Bilder (Tracking-Schutz) ──
  remoteImagesBlockedOne: {
    en: '1 remote image blocked (tracking protection)',
    de: '1 externes Bild blockiert (Tracking-Schutz)'
  },
  remoteImagesBlocked: {
    en: '{n} remote images blocked (tracking protection)',
    de: '{n} externe Bilder blockiert (Tracking-Schutz)'
  },
  remoteImagesShow: { en: 'Show', de: 'Anzeigen' },
  remoteImagesAllowSender: { en: 'Always for {addr}', de: 'Immer von {addr}' },
  linkMismatchWarn: {
    en: 'Link text says {shown}, but it leads to {actual}',
    de: 'Der Linktext zeigt {shown}, der Link führt aber zu {actual}'
  },
  linkMismatchOpen: { en: 'Open anyway', de: 'Trotzdem öffnen' },

  // ── Owl-View (Suchen + Fragen in einem Eingabefeld) ──
  chatEmptyTitle: { en: 'Ask your inbox.', de: 'Frag deine E-Mails.' },
  chatSuggestion1: {
    en: 'Which invoices did I receive this month?',
    de: 'Welche Rechnungen habe ich diesen Monat bekommen?'
  },
  chatSuggestion2: {
    en: 'What was the latest security alert?',
    de: 'Was war die letzte Sicherheitswarnung?'
  },
  chatSuggestion3: {
    en: 'Summarize my unread email',
    de: 'Fasse meine ungelesenen E-Mails zusammen'
  },
  chatError: { en: 'Error: {msg}', de: 'Fehler: {msg}' },
  owlConvHead: { en: 'CONVERSATIONS', de: 'GESPRÄCHE' },
  owlNewChat: { en: 'NEW', de: 'NEU' },
  owlNewChatHint: { en: 'New question (n)', de: 'Neue Frage (n)' },
  owlConvSub: { en: "↳ = THE OWL'S ANSWER", de: '↳ = ANTWORT DER EULE' },
  owlConvEmpty: { en: 'Nothing asked yet.', de: 'Noch nichts gefragt.' },
  owlConvEmptySub: {
    en: 'THE OWL REMEMBERS EVERY ANSWER',
    de: 'DIE EULE MERKT SICH JEDE ANTWORT'
  },
  owlKeyOpen: { en: 'open', de: 'öffnen' },
  owlKeyNew: { en: 'new question', de: 'neue Frage' },
  owlDeleteConv: { en: 'Delete conversation', de: 'Gespräch löschen' },
  owlInputPh: {
    en: 'Search your email — ↵ asks the owl…',
    de: 'E-Mails durchsuchen – ↵ fragt die Eule…'
  },
  owlFollowUpPh: { en: 'Ask a follow-up…', de: 'Stell eine Folgefrage…' },
  owlEscClear: { en: 'ESC CLEAR', de: 'ESC LEEREN' },
  owlAskLabel: { en: 'Ask the owl:', de: 'Frag die Eule:' },
  owlAskNote: {
    en: 'SYNTHESIZED ANSWER · CITES THE HITS BELOW',
    de: 'ANTWORT MIT QUELLEN AUS DEN TREFFERN UNTEN'
  },
  owlAskDisabled: {
    en: 'the owl sleeps — add a key in Settings → AI',
    de: 'Die Eule schläft – hinterlege einen Schlüssel unter Einstellungen → KI'
  },
  owlHitsLabel: { en: 'EMAIL · BEST MATCHES', de: 'E-MAILS · BESTE TREFFER' },
  owlHitsNote: {
    en: 'LIVE FROM YOUR INDEX, NO TOKENS SPENT',
    de: 'LIVE AUS DEINEM INDEX · KEINE TOKENS VERBRAUCHT'
  },
  owlHitOpen: { en: '↵ OPEN', de: '↵ ÖFFNEN' },
  owlEmptySub: {
    en: 'THE OWL ANSWERS FROM YOUR EMAIL — WITH SOURCES',
    de: 'DIE EULE ANTWORTET AUS DEINEN E-MAILS – MIT QUELLEN'
  },
  owlYouAsked: { en: 'YOU ASKED · {time}', de: 'DEINE FRAGE · {time}' },
  owlAnsweredFrom: { en: 'answered from {n} threads', de: 'beantwortet aus {n} Unterhaltungen' },
  owlAnsweredFromOne: { en: 'answered from one thread', de: 'beantwortet aus einer Unterhaltung' },
  owlAnsweredFromSources: { en: 'answered from {n} sources', de: 'beantwortet aus {n} Quellen' },
  owlAnsweredFromOneSource: { en: 'answered from one source', de: 'beantwortet aus einer Quelle' },
  owlSourcesAlsoChecked: {
    en: '+ {n} more threads checked, not cited in the answer',
    de: '+ {n} weitere Unterhaltungen geprüft, in der Antwort nicht zitiert'
  },
  owlAnswering: { en: 'reading your email…', de: 'liest deine E-Mails…' },
  owlSources: { en: 'SOURCES', de: 'QUELLEN' },
  owlSourceOpen: { en: 'OPEN →', de: 'ÖFFNEN →' },
  owlYou: { en: 'YOU · {time}', de: 'DU · {time}' },
  owlFooterHits: { en: 'HITS', de: 'TREFFER' },
  owlFooterOpen: {
    en: 'OPEN SELECTED · ASK WHEN NONE',
    de: 'ÖFFNET DIE AUSWAHL · OHNE AUSWAHL FRAGT DIE EULE'
  },
  owlIndexStatus: {
    en: 'THE OWL INDEXES {n} EMAILS · {coverage}% EMBEDDED · LOCAL',
    de: 'DIE EULE INDEXIERT {n} E-MAILS · {coverage}% SEMANTISCH · LOKAL'
  },

  // ── Konto-Dialog (Onboarding) ──
  addAccountTitle: { en: 'Add account', de: 'Konto hinzufügen' },
  addImapGeneric: { en: 'Other provider (IMAP)', de: 'Anderer Anbieter (IMAP)' },
  addMicrosoftButton: { en: 'Sign in with Microsoft', de: 'Mit Microsoft anmelden' },
  addMicrosoftNote: {
    en: 'You sign in with Microsoft in your browser — Noctua never sees your password. Works with Hotmail, Outlook.com and Live addresses.',
    de: 'Du meldest dich in deinem Browser bei Microsoft an – Noctua sieht dein Passwort nie. Funktioniert mit Hotmail-, Outlook.com- und Live-Adressen.'
  },
  addGoogleButton: { en: 'Sign in with Google', de: 'Mit Google anmelden' },
  addGoogleNote: {
    en: 'You sign in with Google in your browser — Noctua never sees your password, and no app password is needed.',
    de: 'Du meldest dich in deinem Browser bei Google an – Noctua sieht dein Passwort nie. Ein App-Passwort brauchst du nicht mehr.'
  },
  addSyncRangeLabel: { en: 'How far back should we sync?', de: 'Wie weit zurück synchronisieren?' },
  addSyncDefault: {
    en: 'Default — last 90 days (search: 6 months)',
    de: 'Standard – letzte 90 Tage (Suche: 6 Monate)'
  },
  addSync30: { en: 'Last 30 days', de: 'Letzte 30 Tage' },
  addSync90: { en: 'Last 90 days', de: 'Letzte 90 Tage' },
  addSync365: { en: 'Last year', de: 'Letztes Jahr' },
  addSyncAll: { en: 'Everything', de: 'Alles' },
  addLoginFailed: { en: 'Sign-in failed', de: 'Anmeldung fehlgeschlagen' },
  addWaitingForBrowser: {
    en: 'Waiting for browser sign-in…',
    de: 'Warte auf die Anmeldung im Browser…'
  },
  addBrowserTabNote: {
    en: 'A browser tab has opened. Sign in and approve there — this window waits for you.',
    de: 'Im Browser wurde ein Tab geöffnet. Melde dich dort an und erteile die Freigabe – dieses Fenster wartet so lange.'
  },
  addEmailPh: { en: 'Email address', de: 'E-Mail-Adresse' },
  addPasswordPh: { en: 'Password', de: 'Passwort' },
  addImapHostPh: { en: 'IMAP host', de: 'IMAP-Host' },
  addSmtpHostPh: { en: 'SMTP host', de: 'SMTP-Host' },
  addPortPh: { en: 'Port', de: 'Port' },
  addConnectionFailed: { en: 'Connection failed', de: 'Verbindung fehlgeschlagen' },
  addChecking: { en: 'Checking connection…', de: 'Verbindung wird geprüft…' },
  addConnect: { en: 'Connect', de: 'Verbinden' },

  // ── Masthead ──
  navCompose: { en: 'NEW EMAIL', de: 'NEUE E-MAIL' },
  navInbox: { en: 'INBOX', de: 'POSTEINGANG' },
  navWaiting: { en: 'WAITING', de: 'AUSSTEHEND' },
  navTasks: { en: 'TASKS', de: 'AUFGABEN' },
  navSettings: { en: 'SETTINGS', de: 'EINSTELLUNGEN' },

  // ── Key-Strip / g-Hint ──
  keyMove: { en: 'move', de: 'navigieren' },
  keyFile: { en: 'archive', de: 'archivieren' },
  keyDictate: { en: 'dictate', de: 'diktieren' },
  keyKeys: { en: 'keys', de: 'Kürzel' },

  // ── Inbox-Liste ──
  mailboxFilterLabel: { en: 'ACCOUNT', de: 'KONTO' },
  mailboxFilterAll: { en: 'ALL ACCOUNTS', de: 'ALLE KONTEN' },
  mailboxFilterLoading: { en: 'LOADING…', de: 'LÄDT…' },
  mailboxFilterNone: { en: 'NO ACCOUNT', de: 'KEIN KONTO' },
  mailboxFilterCount: { en: '{n} connected', de: '{n} verbunden' },
  mailboxFilterAria: {
    en: 'Filter email by account. Selected: {name}',
    de: 'E-Mails nach Konto filtern. Ausgewählt: {name}'
  },
  mailboxTabsAria: { en: 'Folder', de: 'Ordner' },
  chipTask: { en: 'TASK', de: 'AUFGABE' },
  chipDraftReady: { en: 'DRAFT READY', de: 'ENTWURF BEREIT' },
  prioAria5: { en: 'priority 5 of 5 — rings', de: 'Priorität 5 von 5 – mit Signalton' },
  prioAria4: { en: 'priority 4 of 5 — notifies', de: 'Priorität 4 von 5 – mit Benachrichtigung' },
  helpPrio5: { en: 'urgent — priority 5, it rings', de: 'dringend – Priorität 5, mit Signalton' },
  helpPrio4: {
    en: 'high — priority 4, it notifies',
    de: 'wichtig – Priorität 4, mit Benachrichtigung'
  },
  triageHead: { en: 'TRIAGE', de: 'EINSCHÄTZUNG' },
  triagePriority: { en: 'PRIORITY {n} OF 5', de: 'PRIORITÄT {n} VON 5' },
  triageNeedsReply: { en: 'NEEDS A REPLY', de: 'ANTWORT NÖTIG' },
  prioNote: {
    en: 'priority 4+ raises a desktop notification · 5 rings — set in Settings → AI',
    de: 'Ab Priorität 4 gibt es eine Desktop-Benachrichtigung, bei 5 zusätzlich einen Signalton – einstellbar unter Einstellungen → KI'
  },
  needsYou: { en: 'NEEDS YOU', de: 'BRAUCHT DICH' },
  needsYouAll: { en: 'ALL', de: 'ALLE' },
  filterClearAll: { en: 'reset', de: 'zurücksetzen' },
  filterChipRemove: { en: 'remove filter: {name}', de: 'Filter entfernen: {name}' },
  filterSectPriority: { en: 'PRIORITY', de: 'PRIORITÄT' },
  filterShowAll: { en: 'Show all', de: 'Alle anzeigen' },
  filterZero: { en: 'Nothing matches your filters.', de: 'Nichts passt zu deinen Filtern.' },
  filterZeroSub: { en: 'LOOSEN A FILTER, SEE MORE', de: 'FILTER LOCKERN, MEHR SEHEN' },
  needsYouRankNote: { en: '— priority 4+', de: '– Priorität 4+' },
  needsYouFilterLabel: { en: 'FILTER', de: 'FILTER' },
  keyNeedsYou: { en: 'needs you', de: 'braucht dich' },
  needsYouZero: { en: 'Nothing needs you right now.', de: 'Nichts braucht dich gerade.' },
  needsYouZeroSub: { en: 'RARE. ENJOY IT.', de: 'SELTEN. GENIESS ES.' },
  inboxZero: { en: 'Inbox zero.', de: 'Posteingang leer.' },
  inboxZeroSub: {
    en: 'THE OWL APPROVES · Z TO UNDO',
    de: 'DIE EULE IST ZUFRIEDEN · Z MACHT RÜCKGÄNGIG'
  },

  // ── Waiting ──
  waitingHead: { en: 'WAITING ON A REPLY', de: 'WARTET AUF ANTWORT' },
  waitingSub: { en: 'THE OWL COUNTS THE DAYS', de: 'DIE EULE ZÄHLT DIE TAGE' },
  daysSilent: { en: '{d}d silent', de: 'seit {d} T.' },
  today: { en: 'today', de: 'heute' },
  nudgedToday: { en: '✓ NUDGED TODAY', de: '✓ HEUTE GESTUPST' },
  waitingEmpty: { en: 'Nobody owes you a reply.', de: 'Niemand schuldet dir eine Antwort.' },
  waitingEmptySub: { en: 'RARE. ENJOY IT.', de: 'SELTEN. GENIESS ES.' },
  youArrow: { en: 'YOU →', de: 'DU →' },
  sentDaysAgo: { en: 'SENT {d} DAYS AGO', de: 'GESENDET VOR {d} TAGEN' },
  sentToday: { en: 'SENT TODAY', de: 'HEUTE GESENDET' },
  silence: { en: 'SILENCE', de: 'FUNKSTILLE' },
  silenceLine: {
    en: '{d} days without an answer. The owl suggests a gentle nudge.',
    de: '{d} Tage ohne Antwort. Die Eule schlägt einen freundlichen Stups vor.'
  },
  silenceToday: {
    en: 'Sent today — the owl starts counting tonight.',
    de: 'Heute gesendet – die Eule beginnt heute Nacht zu zählen.'
  },
  nudgeLabel: { en: 'NUDGE, DRAFTED IN YOUR VOICE', de: 'STUPS – IN DEINEM STIL ENTWORFEN' },
  nudgeSub: { en: '— polite, no pressure', de: '– höflich, ohne Druck' },
  sendNudge: { en: 'SEND NUDGE', de: 'STUPS SENDEN' },
  stopWaiting: { en: 'STOP WAITING', de: 'NICHT MEHR WARTEN' },
  nudgedNote: {
    en: 'The owl will tell you the moment they answer.',
    de: 'Die Eule sagt dir sofort Bescheid, wenn die Antwort kommt.'
  },
  composerNudgePlaceholder: {
    en: 'The owl drafts your nudge — edit, dictate, or rewrite it…',
    de: 'Die Eule entwirft deinen Stups – du kannst ihn bearbeiten, diktieren oder umformulieren…'
  },
  originalSentMail: { en: 'YOUR ORIGINAL EMAIL', de: 'DEINE URSPRÜNGLICHE E-MAIL' },
  originalMailLoading: {
    en: 'Loading the original email…',
    de: 'Ursprüngliche E-Mail wird geladen…'
  },
  originalMailUnavailable: {
    en: 'The original email is no longer available locally.',
    de: 'Die ursprüngliche E-Mail ist lokal nicht mehr verfügbar.'
  },

  // ── Tasks ──
  tasksHead: { en: 'TASKS — FOUND IN YOUR EMAIL', de: 'AUFGABEN – AUS E-MAILS ERKANNT' },
  tasksSub: { en: 'SPACE TO CHECK OFF', de: 'LEERTASTE ZUM ABHAKEN' },
  tasksFilterStatus: { en: 'STATUS', de: 'STATUS' },
  tasksFilterOpen: { en: 'OPEN', de: 'OFFEN' },
  tasksFilterCompleted: { en: 'COMPLETED', de: 'ERLEDIGT' },
  tasksFilterAll: { en: 'ALL', de: 'ALLE' },
  tasksFilterNone: { en: 'NONE', de: 'KEINE' },
  tasksFilterNothing: { en: 'Nothing shown.', de: 'Nichts angezeigt.' },
  tasksFilterNothingSub: { en: 'ALL STATUS FILTERS ARE OFF', de: 'ALLE STATUS-FILTER SIND AUS' },
  tasksFilterAria: {
    en: 'Filter tasks by status. Current view: {state}',
    de: 'Aufgaben nach Status filtern. Aktuelle Ansicht: {state}'
  },
  taskFrom: { en: 'from {src}', de: 'aus {src}' },
  task: { en: 'TASK', de: 'AUFGABE' },
  extractedAuto: { en: 'found automatically', de: 'automatisch erkannt' },
  source: { en: 'SOURCE', de: 'QUELLE' },
  spaceDone: { en: 'DONE', de: 'ERLEDIGT' },
  spaceReopen: { en: 'REOPEN', de: 'WIEDER ÖFFNEN' },
  spaceKey: { en: 'SPACE', de: 'LEERTASTE' },
  openThread: { en: 'O OPEN THREAD', de: 'O E-MAIL ÖFFNEN' },
  threadFiled: { en: 'That thread no longer exists', de: 'Diese Unterhaltung gibt es nicht mehr' },
  tasksEmpty: { en: 'No tasks found yet.', de: 'Noch nichts erkannt.' },
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
  mailDetailsSender: { en: 'SENDER', de: 'SENDER-HEADER' },
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
    en: 'Signals reported by the mail server — useful evidence, not a guarantee that the message is trustworthy.',
    de: 'Gemeldete Signale des Mailservers – hilfreiche Hinweise, aber keine Garantie, dass die E-Mail vertrauenswürdig ist.'
  },
  mailDetailsReplyMismatch: {
    en: 'The reply address uses a different domain than the visible sender.',
    de: 'Die Antwortadresse hat eine andere Domain als der angezeigte Absender.'
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
  mailDetailsAuthTemperror: { en: 'temporary error', de: 'vorübergehender Fehler' },
  mailDetailsAuthPermerror: { en: 'configuration error', de: 'Konfigurationsfehler' },
  mailDetailsAuthNone: { en: 'not provided', de: 'nicht angegeben' },
  mailDetailsAuthUnknown: { en: 'unknown', de: 'unbekannt' },
  mailDetailsLoading: {
    en: 'Fetching technical headers from the mail server…',
    de: 'Technische Header werden vom Server abgerufen…'
  },
  mailDetailsLoaded: {
    en: 'Technical email headers loaded.',
    de: 'Technische E-Mail-Header geladen.'
  },
  mailDetailsUnavailable: {
    en: 'Technical headers are not available right now. The basic sender and recipient data cached locally remains visible above.',
    de: 'Die technischen Header sind gerade nicht verfügbar. Die lokal gespeicherten Basisdaten zu Absender und Empfängern bleiben oben sichtbar.'
  },
  mailDetailsRaw: { en: 'RAW MESSAGE HEADERS', de: 'ROH-HEADER' },
  mailDetailsRawTruncated: {
    en: 'Header display was capped at 512 KB.',
    de: 'Die Anzeige der Header ist auf 512 KB begrenzt.'
  },

  // ── Masthead search ──
  mastheadSearch: { en: 'SEARCH', de: 'SUCHEN' },

  // ── Composer ──
  listening: { en: 'LISTENING', de: 'HÖRT ZU' },
  voiceNothingHeard: {
    en: 'Could not hear anything — please dictate again',
    de: 'Nichts zu hören – bitte diktiere noch einmal'
  },
  voiceQueryStart: { en: 'Dictate your question (⌘D)', de: 'Frage diktieren (⌘D)' },
  voicePrefix: { en: 'voice:', de: 'diktat:' },
  send: { en: '↵ SEND', de: '↵ SENDEN' },
  redraft: { en: '⇧R REDRAFT', de: '⇧R NEU ENTWERFEN' },

  // ── Owl-Rail ──
  theOwl: { en: 'THE OWL', de: 'DIE EULE' },
  owlQuiet: { en: 'working quietly', de: 'arbeitet leise' },
  owlAsleepNoKey: { en: 'asleep — no key.', de: 'schläft – kein Schlüssel.' },
  owlAsleepLocalOnly: {
    en: 'asleep — Local only, no local model set.',
    de: 'schläft – „Nur lokal“ ist an, aber kein lokales Modell gewählt.'
  },
  owlListening: { en: 'listening…', de: 'hört zu…' },
  owlDraftingS: { en: 'drafting…', de: 'entwirft…' },
  railDrafts: { en: 'DRAFTS AWAITING YOU', de: 'ENTWÜRFE FÜR DICH' },
  railDraftNone: {
    en: 'None right now. Press {v} on any thread and talk — a draft appears here.',
    de: 'Gerade keine. Drück {v} bei einer Unterhaltung und sprich – der Entwurf erscheint hier.'
  },
  railReview: { en: '↵ REVIEW', de: '↵ PRÜFEN' },
  railReplyTo: { en: 'Reply to {name}', de: 'Antwort an {name}' },
  railDraftDelete: { en: 'Discard draft', de: 'Entwurf verwerfen' },
  railDraftMore: { en: '+ {n} more', de: '+ {n} weitere' },
  toastDraftDeleted: { en: 'Draft discarded', de: 'Entwurf verworfen' },
  railTasksHead: { en: 'TASKS FROM EMAIL', de: 'AUFGABEN AUS E-MAILS' },
  railOpenArrow: { en: '{n} open →', de: '{n} offen →' },
  railWaitingHead: { en: 'NO REPLY YET', de: 'NOCH KEINE ANTWORT' },
  railWaitingArrow: { en: '{n} waiting →', de: '{n} ausstehend →' },
  nudgeBtn: { en: 'NUDGE', de: 'STUPS' },
  railNudgeNote: {
    en: 'nudges drafted in your voice — you approve every send',
    de: 'Stups-Entwürfe in deinem Stil – jeder Versand braucht dein OK'
  },
  yourStyle: { en: 'YOUR STYLE', de: 'DEIN STIL' },
  railVoiceNote: {
    en: 'Writing as {addr} — learned from your sent replies.',
    de: 'Schreibt als {addr} – gelernt aus deinen gesendeten Antworten.'
  },

  // ── Settings ──
  settingsHead: { en: 'SETTINGS — LOCAL, YOURS', de: 'EINSTELLUNGEN – LOKAL, GANZ DEINE' },
  setAccounts: { en: 'Accounts', de: 'Konten' },
  setStyle: { en: 'Style', de: 'Stil' },
  setIntel: { en: 'AI', de: 'KI' },
  setAccountsSub: {
    en: '{n} connected · Google, Microsoft, IMAP',
    de: '{n} verbunden · Google, Microsoft, IMAP'
  },
  setStyleSub: { en: 'one per address', de: 'einer pro Adresse' },
  setIntelSubNoKey: { en: 'bring your own OpenRouter key', de: 'eigener OpenRouter-Schlüssel' },
  setIntelSub: { en: '{scan} scans · {write} writes', de: '{scan} scannt · {write} schreibt' },
  setTech: { en: 'Under the hood', de: 'Unter der Haube' },
  setTechSub: { en: 'how the owl thinks — in pictures', de: 'wie die Eule denkt – in Bildern' },
  connectedAddresses: { en: 'Connected addresses', de: 'Verbundene Adressen' },
  accountName: { en: 'Account name', de: 'Kontoname' },
  accountNamePh: {
    en: 'Account name, e.g. Personal or Europe',
    de: 'Kontoname, z. B. Privat oder Europa'
  },
  accountNameEditHint: {
    en: 'Edit account name · saves automatically',
    de: 'Kontoname bearbeiten · wird automatisch gespeichert'
  },
  accountNameSaving: { en: 'saving…', de: 'speichert…' },
  accountNameSaved: { en: '✓ saved', de: '✓ gespeichert' },
  toastAccountNameRequired: {
    en: 'Please enter a unique account name',
    de: 'Bitte gib einen eindeutigen Kontonamen ein'
  },
  microsoftBrowserNote: {
    en: 'the Microsoft login opens in your browser',
    de: 'die Microsoft-Anmeldung öffnet sich im Browser'
  },
  googleBrowserNote: {
    en: 'the Google login opens in your browser — no app password needed',
    de: 'die Google-Anmeldung öffnet sich im Browser – kein App-Passwort nötig'
  },
  accountsSub: {
    en: 'ONE STYLE PER ADDRESS · INDEXED LOCALLY',
    de: 'EIN STIL PRO ADRESSE · LOKAL INDEXIERT'
  },
  synced: { en: '✓ synced', de: '✓ synchronisiert' },
  indexing: { en: 'indexing…', de: 'indexiert…' },
  errorState: { en: 'error', de: 'Fehler' },
  disconnect: { en: 'DISCONNECT', de: 'TRENNEN' },
  // Zweitklick-Bestätigung beim Trennen (Design 3b)
  disconnectHint: {
    en: 'removes the account + its local index',
    de: 'entfernt das Konto und seinen lokalen Index'
  },
  disconnectYes: { en: 'YES, DISCONNECT', de: 'JA, TRENNEN' },
  disconnectKeep: { en: 'KEEP', de: 'BEHALTEN' },
  // Sync-Fehler inline (Design 3b): gespeicherter Fehlertext + Zeitpunkt
  syncFailed: { en: 'sync failed', de: 'Sync fehlgeschlagen' },
  syncNeedsReauth: { en: 'sign-in needed', de: 'Anmeldung nötig' },
  syncNeedsReauthHint: {
    en: 'The server rejected the sign-in — update the password or sign in again.',
    de: 'Der Server hat die Anmeldung abgelehnt – aktualisiere das Passwort oder melde dich erneut an.'
  },
  credReenter: { en: 'RE-ENTER PASSWORD', de: 'PASSWORT NEU EINGEBEN' },
  credSignInAgain: { en: 'SIGN IN AGAIN', de: 'ERNEUT ANMELDEN' },
  credNewPassword: { en: 'New password', de: 'Neues Passwort' },
  credSave: { en: 'SAVE', de: 'SPEICHERN' },
  credChecking: { en: 'checking···', de: 'wird geprüft···' },
  credCancel: { en: 'CANCEL', de: 'ABBRECHEN' },
  toastCredUpdated: { en: 'Password updated', de: 'Passwort aktualisiert' },
  toastReauthorized: { en: 'Signed in again', de: 'Erneut angemeldet' },
  sinceTime: { en: 'since {time}', de: 'seit {time}' },
  addAddress: { en: 'ADD AN ADDRESS', de: 'ADRESSE HINZUFÜGEN' },
  waitingForBrowser: {
    en: 'waiting for the browser sign-in···',
    de: 'wartet auf die Anmeldung im Browser···'
  },
  waitingForBrowserHint: { en: '— check your browser window', de: '– sieh im Browserfenster nach' },
  cancelCaps: { en: 'CANCEL', de: 'ABBRECHEN' },
  imapAddrPh: { en: 'address — you@yourdomain.com', de: 'Adresse – du@deinedomain.de' },
  imapHostPh: { en: 'imap host — mail.yourdomain.com', de: 'IMAP-Host – mail.deinedomain.de' },
  smtpHostOptionalPh: { en: 'smtp host — empty = same as imap', de: 'SMTP-Host – leer = wie IMAP' },
  imapPassPh: { en: 'password', de: 'Passwort' },
  connect: { en: 'CONNECT', de: 'VERBINDEN' },
  imapNote: {
    en: 'port 993 = SSL, others STARTTLS · Proton Bridge: 127.0.0.1, ports 1143/1025',
    de: 'Port 993 = SSL, sonst STARTTLS · Proton Bridge: 127.0.0.1, Ports 1143/1025'
  },
  accountsFootnote: {
    en: 'New addresses appear in the filters after the first sync. The owl reads that account’s Sent folder and starts learning its style.',
    de: 'Neue Adressen tauchen nach dem ersten Sync in den Filtern auf. Die Eule liest den Ordner „Gesendet“ dieses Kontos und beginnt, seinen Stil zu lernen.'
  },
  mailCount: { en: '{n} emails', de: '{n} E-Mails' },
  customModelToggle: { en: 'custom model…', de: 'eigenes Modell…' },
  customModelNote: {
    en: 'The listed models are tried and tested. Any OpenRouter model works too — cost and suitability are then up to you. The test runs a sample email through the scanner prompt.',
    de: 'Die aufgeführten Modelle sind erprobt. Jedes OpenRouter-Modell funktioniert ebenfalls – Kosten und Eignung musst du dann selbst einschätzen. Der Test schickt eine Beispiel-E-Mail durch den Scanner-Prompt.'
  },
  customModelPh: {
    en: 'provider/model — e.g. moonshotai/kimi-k2',
    de: 'anbieter/modell – z. B. moonshotai/kimi-k2'
  },
  customModelTest: { en: 'TEST', de: 'TESTEN' },
  customModelApply: { en: 'USE MODEL', de: 'ÜBERNEHMEN' },
  customModelOk: { en: '✓ works — {ms} ms · ~{cost}', de: '✓ funktioniert – {ms} ms · ca. {cost}' },
  customModelFailed: { en: 'test failed', de: 'Test fehlgeschlagen' },
  zdrHead: { en: 'PRIVACY', de: 'DATENSCHUTZ' },
  zdrLabel: {
    en: 'ZERO-DATA-RETENTION PROVIDERS ONLY',
    de: 'NUR ANBIETER OHNE DATENSPEICHERUNG'
  },
  zdrNote: {
    en: 'Requests are routed only to providers that don’t store prompts (ZDR). Turning this off can make more models available — without that guarantee.',
    de: 'Anfragen gehen nur an Anbieter, die Prompts nicht speichern (Zero Data Retention). Wenn du das ausschaltest, stehen eventuell mehr Modelle zur Verfügung – ohne diese Garantie.'
  },
  obSyncingMails: { en: 'LOADING EMAILS · {n}', de: 'E-MAILS WERDEN GELADEN · {n}' },
  obSyncNote: {
    en: 'emails keep loading in the background — you can already continue',
    de: 'E-Mails werden im Hintergrund weiter geladen – du kannst schon fortfahren'
  },
  yourStyleHead: { en: 'Your style', de: 'Dein Stil' },
  styleSub: {
    en: 'ONE PER ADDRESS · LEARNED FROM SENT EMAILS · STORED LOCALLY',
    de: 'EINER PRO ADRESSE · AUS GESENDETEN E-MAILS GELERNT · LOKAL GESPEICHERT'
  },
  styleIntro: {
    en: 'Every draft starts from the address you’re answering from. The owl studies each account’s sent replies — tone, greetings, sign-offs, language — and writes accordingly.',
    de: 'Jeder Entwurf beginnt bei der Adresse, von der du antwortest. Die Eule liest die gesendeten Antworten jedes Kontos – Ton, Anrede, Grußformel, Sprache – und schreibt entsprechend.'
  },
  learnFromSends: { en: 'learn from my sent emails', de: 'aus meinen gesendeten E-Mails lernen' },
  retrain: { en: 'RETRAIN', de: 'NEU LERNEN' },
  voiceRulesLabel: { en: 'YOUR RULES FOR THIS ADDRESS', de: 'DEINE REGELN FÜR DIESE ADRESSE' },
  voiceRulesPh: {
    en: 'e.g. always informal, short sentences, sign off with “Cheers, Tim”',
    de: 'z. B. immer duzen, kurze Sätze, Gruß „Viele Grüße, Tim“'
  },
  previewBtn: { en: 'SAMPLE REPLY', de: 'BEISPIEL' },
  previewRunning: { en: 'WRITING…', de: 'SCHREIBT…' },
  previewLabel: {
    en: 'SAMPLE — REPLY TO A TEST EMAIL',
    de: 'BEISPIEL – ANTWORT AUF EINE TEST-E-MAIL'
  },
  voiceRulesSaved: { en: '✓ saved', de: '✓ gespeichert' },
  reading: { en: 'READING…', de: 'LIEST…' },
  replies: { en: '{n} replies', de: '{n} Antworten' },
  updatedToday: { en: 'updated today', de: 'heute aktualisiert' },
  updatedYesterday: { en: 'updated yesterday', de: 'gestern aktualisiert' },
  updatedDaysAgo: { en: 'updated {n} days ago', de: 'vor {n} Tagen aktualisiert' },
  // Ehrlich gescheitertes Nachlernen (Design 3e) — Gründe für ok:false
  voiceNoSent: {
    en: 'no sent replies to learn from yet',
    de: 'noch keine gesendeten Antworten zum Lernen'
  },
  noProfileYet: {
    en: 'not learned yet — press RETRAIN',
    de: 'noch nicht gelernt – drück NEU LERNEN'
  },
  tryIt: { en: 'TRY IT', de: 'PROBIER ES AUS' },
  tryItLine: {
    en: 'Pick any thread in the inbox, press {v} — the reply arrives in that address’s voice.',
    de: 'Wähl im Posteingang eine Unterhaltung aus und drück {v} – die Antwort kommt im Stil dieser Adresse.'
  },
  styleFootnote: {
    en: 'Learned locally. Delete a style any time — the owl forgets politely.',
    de: 'Lokal gelernt. Du kannst einen Stil jederzeit löschen – die Eule vergisst höflich.'
  },
  intelligence: { en: 'AI', de: 'KI' },
  intelSub: {
    en: 'YOUR KEYS, YOUR SERVERS · CALLS GO STRAIGHT TO THE PROVIDER YOU CHOOSE · NOTHING PASSES THROUGH US',
    de: 'EIGENE SCHLÜSSEL, EIGENE SERVER · ANFRAGEN GEHEN DIREKT AN DEN GEWÄHLTEN ANBIETER · NICHTS LÄUFT ÜBER UNS'
  },
  orKeyHead: { en: 'OPENROUTER KEY', de: 'OPENROUTER-SCHLÜSSEL' },
  save: { en: 'SAVE', de: 'SPEICHERN' },
  orNoKey: {
    en: 'no key yet — scanning & drafting are paused until you add one',
    de: 'noch kein Schlüssel – Scannen & Entwerfen pausieren, bis du einen hinterlegst'
  },
  orSaved: {
    en: '✓ saved · sk-or-•••• — in the macOS keychain, it never leaves this machine',
    de: '✓ gespeichert · sk-or-•••• – im macOS-Schlüsselbund, verlässt diesen Rechner nie'
  },
  modelScan: { en: 'MODEL — INBOX SCANNING', de: 'MODELL – POSTEINGANG SCANNEN' },
  modelScanSub: {
    en: 'gists · tasks · reply tracking, on every email — cheap wins',
    de: 'Kurzfassungen · Aufgaben · Nachverfolgung unbeantworteter E-Mails – hier gewinnt günstig'
  },
  modelWrite: { en: 'MODEL — WRITING', de: 'MODELL – SCHREIBEN' },
  modelWriteSub: {
    en: 'your drafts, your nudges — quality wins',
    de: 'deine Entwürfe, deine Stupser – hier gewinnt Qualität'
  },
  modelStt: { en: 'MODEL — DICTATION', de: 'MODELL – DIKTAT' },
  modelSttSub: {
    en: 'turns your voice into the idea — audio-capable models',
    de: 'macht aus Gesprochenem deinen Entwurf – Modelle mit Audio-Eingabe'
  },
  toastSttModel: {
    en: 'Dictation now transcribed by {model}',
    de: 'Diktat wird jetzt von {model} transkribiert'
  },
  accountColor: { en: 'COLOR', de: 'FARBE' },
  // Privacy-Default gedreht (Design 3b): blocken, bis der Nutzer erlaubt
  privacyHead: { en: 'PRIVACY', de: 'PRIVATSPHÄRE' },
  imagesBlockToggle: {
    en: 'block remote images until I allow them',
    de: 'externe Bilder blockieren, bis ich sie erlaube'
  },
  imagesBlockNote: {
    en: 'per-sender allow remembers your choice',
    de: 'Freigaben pro Absender merkt sich die Eule'
  },
  intelFootnote: {
    en: 'No key? Email still works — the owl just sleeps: no gists, no drafts, no counting.',
    de: 'Kein Schlüssel? E-Mail funktioniert trotzdem – nur die Eule schläft: keine Kurzfassungen, keine Entwürfe, kein Zählen.'
  },

  // ── KI-Anbieter (Profile), Aufgaben-Zuordnung, Local only ──
  profilesHead: { en: 'AI PROVIDERS', de: 'KI-ANBIETER' },
  profilesSub: {
    en: 'OpenRouter or any OpenAI-compatible server — Ollama, LM Studio, vLLM, LiteLLM …',
    de: 'OpenRouter oder jeder OpenAI-kompatible Server – Ollama, LM Studio, vLLM, LiteLLM …'
  },
  profileLocal: { en: 'LOCAL', de: 'LOKAL' },
  profileExternal: { en: 'EXTERNAL', de: 'EXTERN' },
  profileManaged: { en: 'ORGANIZATION', de: 'ORGANISATION' },
  profileManagedNote: {
    en: 'Provided by your organization: URL, API style and name are fixed. Only the key can be changed.',
    de: 'Von deiner Organisation bereitgestellt: URL, API-Stil und Name sind fest vorgegeben. Nur der Schlüssel lässt sich ändern.'
  },
  profileName: { en: 'NAME', de: 'NAME' },
  profileUrl: { en: 'BASE URL', de: 'BASIS-URL' },
  profileStyle: { en: 'API STYLE', de: 'API-STIL' },
  profileStyleChat: { en: 'OpenAI Chat Completions', de: 'OpenAI Chat Completions' },
  profileStyleResponses: { en: 'OpenAI Responses', de: 'OpenAI Responses' },
  profileKey: { en: 'API KEY', de: 'API-SCHLÜSSEL' },
  profileKeyPh: { en: 'optional', de: 'optional' },
  profileKeySaved: {
    en: '✓ saved — type to replace',
    de: '✓ gespeichert – zum Ersetzen einfach tippen'
  },
  profileNoKey: { en: 'no key saved', de: 'kein Schlüssel gespeichert' },
  profileKeyRemove: { en: 'remove key', de: 'Schlüssel entfernen' },
  profileIsLocal: { en: 'Runs locally or on-prem', de: 'Läuft lokal oder im eigenen Netzwerk' },
  profileIsLocalNote: {
    en: 'Counts as local for “Local only”. Suggested from the address — you decide.',
    de: 'Zählt bei „Nur lokal“ als lokal. Vorschlag anhand der Adresse – du entscheidest.'
  },
  profileTest: { en: 'TEST CONNECTION', de: 'VERBINDUNG TESTEN' },
  profileTestOk: {
    en: '✓ connected — {n} models · {ms} ms',
    de: '✓ verbunden – {n} Modelle · {ms} ms'
  },
  profileAdd: { en: '+ add provider', de: '+ Anbieter hinzufügen' },
  profileEdit: { en: 'edit', de: 'bearbeiten' },
  profileClose: { en: 'close', de: 'schließen' },
  profileDelete: { en: 'delete provider', de: 'Anbieter löschen' },
  profileBlockedLocalOnly: { en: 'blocked — Local only', de: 'gesperrt (Nur lokal)' },
  toastProfileSaved: { en: '✓ {name} saved', de: '✓ {name} gespeichert' },
  taskProvider: { en: 'PROVIDER', de: 'ANBIETER' },
  taskBlockedLocalOnly: {
    en: 'External provider — paused while Local only is on. Pick a local one.',
    de: 'Externer Anbieter – pausiert, solange „Nur lokal“ aktiv ist. Wähle einen lokalen.'
  },
  taskBlockedNoKey: {
    en: 'No key yet — this task is paused until you add one.',
    de: 'Noch kein Schlüssel – diese Aufgabe ist pausiert, bis du einen hinterlegst.'
  },
  taskBlockedNoModel: {
    en: 'No model chosen yet — pick one below.',
    de: 'Noch kein Modell gewählt – wähle unten eins aus.'
  },
  taskBlockedNoProfile: {
    en: 'This provider no longer exists — pick another.',
    de: 'Diesen Anbieter gibt es nicht mehr – wähle einen anderen.'
  },
  sttProviderApple: {
    en: 'Apple speech recognition — on this Mac',
    de: 'Apple-Spracherkennung – auf diesem Mac'
  },
  taskAppleNote: {
    en: 'Runs on this Mac — no model, no key, no cost.',
    de: 'Läuft auf diesem Mac – ohne Modell, ohne Schlüssel, ohne Kosten.'
  },
  toastTaskProfile: { en: 'Now using {name}', de: 'Verwendet jetzt {name}' },
  modelsFrom: { en: 'models from {name}', de: 'Modelle von {name}' },
  modelListSkipped: {
    en: 'Local only: the model list is not fetched automatically.',
    de: 'Nur lokal: Die Modellliste wird nicht automatisch abgerufen.'
  },
  modelListLoad: { en: 'LOAD MODEL LIST', de: 'MODELLLISTE LADEN' },
  modelPick: { en: 'choose a model…', de: 'Modell wählen…' },
  modelFreeText: { en: 'or type a model id…', de: 'oder Modell-ID eingeben…' },
  localOnlyHead: { en: 'LOCAL ONLY', de: 'NUR LOKAL' },
  localOnlyLabel: {
    en: 'KEEP AI AND LOOKUPS ON THIS DEVICE',
    de: 'KI UND ABRUFE NUR AUF DIESEM GERÄT'
  },
  localOnlyNote: {
    en: 'AI uses only providers marked local. Nothing is fetched automatically from the internet: no update check, no model catalog, no search-model download, no remote images. Your mail servers and sign-in are not affected.',
    de: 'Die KI nutzt nur Anbieter, die als lokal markiert sind. Aus dem Internet wird nichts automatisch geladen: keine Update-Prüfung, kein Modellkatalog, kein Download des Suchmodells, keine externen Bilder. Deine Mailserver und die Anmeldung sind davon nicht betroffen.'
  },
  localOnlyBadge: { en: 'LOCAL ONLY', de: 'NUR LOKAL' },
  localOnlyBadgeTip: {
    en: 'Local only is on — click for settings',
    de: '„Nur lokal“ ist aktiv – ein Klick öffnet die Einstellungen'
  },
  toastLocalOnlyOn: {
    en: 'Local only is on — AI and lookups stay on this device',
    de: '„Nur lokal“ ist an – KI und Abrufe bleiben auf diesem Gerät'
  },
  toastLocalOnlyOff: { en: 'Local only is off', de: '„Nur lokal“ ist aus' },
  onDemandHead: { en: 'ON DEMAND', de: 'AUF ANFRAGE' },
  onDemandNote: {
    en: 'These run by themselves in the background. With Local only they wait for your click.',
    de: 'Das läuft sonst von selbst im Hintergrund. Mit „Nur lokal“ wartet es auf deinen Klick.'
  },
  onDemandNoteLocal: {
    en: 'Local only is on — nothing below runs by itself. Use the buttons when you want it.',
    de: '„Nur lokal“ ist an – nichts davon läuft von selbst. Nutze die Schaltflächen, wenn du es brauchst.'
  },
  updatesHead: { en: 'UPDATES', de: 'UPDATES' },
  updateCheckBtn: { en: 'CHECK FOR UPDATES', de: 'AUF UPDATES PRÜFEN' },
  updateUpToDate: { en: 'You are up to date.', de: 'Du bist auf dem neuesten Stand.' },
  embedHead: { en: 'SEARCH MODEL', de: 'SUCHMODELL' },
  embedReady: {
    en: 'ready — semantic search on ({n}/{total} emails indexed)',
    de: 'bereit – semantische Suche aktiv ({n}/{total} E-Mails indexiert)'
  },
  embedMissing: {
    en: 'not downloaded yet — it loads by itself, or start it now',
    de: 'noch nicht geladen – wird automatisch geladen, oder starte es jetzt'
  },
  embedMissingLocal: {
    en: 'not downloaded — search uses full text only',
    de: 'nicht geladen – die Suche nutzt nur Volltext'
  },
  embedDownload: { en: 'DOWNLOAD SEARCH MODEL (~120 MB)', de: 'SUCHMODELL LADEN (~120 MB)' },
  embedDownloading: { en: 'DOWNLOADING…', de: 'LÄDT…' },
  toastEmbedReady: {
    en: '✓ Search model ready — indexing starts',
    de: '✓ Suchmodell bereit – Indexierung startet'
  },

  // ── Palette (nur Befehle — die Mailsuche wohnt bei der Eule) ──
  palPlaceholder: { en: 'Type a command…', de: 'Befehl eingeben…' },
  palAria: { en: 'Command palette', de: 'Befehlspalette' },
  palCommandMode: { en: 'COMMANDS ONLY', de: 'NUR BEFEHLE' },
  palCommandSection: { en: 'COMMANDS', de: 'BEFEHLE' },
  palFooterOwl: { en: 'EMAIL SEARCH: / — WITH THE OWL', de: 'E-MAIL-SUCHE: / – BEI DER EULE' },
  palSearchError: {
    en: 'Local search is unavailable right now. Please try again.',
    de: 'Die lokale Suche ist gerade nicht verfügbar. Bitte versuche es erneut.'
  },
  palNoCommands: { en: 'No matching command.', de: 'Kein passender Befehl.' },
  palNoMail: {
    en: 'No reliable match in the local index.',
    de: 'Kein belastbarer Treffer im lokalen Index.'
  },
  palNoSubject: { en: '(no subject)', de: '(ohne Betreff)' },
  palUnknownSender: { en: 'Unknown sender', de: 'Unbekannter Absender' },
  palMailboxInbox: { en: 'Inbox', de: 'Posteingang' },
  palMailboxSent: { en: 'Sent', de: 'Gesendet' },
  palMailboxArchive: { en: 'Archive', de: 'Archiv' },
  palMailboxOther: { en: 'Other folder', de: 'Anderer Ordner' },
  palHitClear: { en: 'CLEAR MATCH', de: 'KLARER TREFFER' },
  palHitPossible: { en: 'POSSIBLE', de: 'MÖGLICH' },
  palIndexLocal: { en: 'LOCAL EMAIL SEARCH', de: 'LOKALE E-MAIL-SUCHE' },
  helpSearch: { en: 'search & ask the owl', de: 'suchen & die Eule fragen' },
  palChoose: { en: '↑↓ CHOOSE', de: '↑↓ WÄHLEN' },
  palRun: { en: '↵ RUN', de: '↵ AUSFÜHREN' },
  cmdReviewNudge: { en: 'Review nudge for {name}', de: 'Stups an {name} prüfen' },
  cmdDictate: { en: 'Dictate a reply to {name}', de: 'Antwort an {name} diktieren' },
  cmdHeroMove: { en: 'the hero move', de: 'der Königsweg' },
  cmdSummarize: { en: 'Summarize thread', de: 'Unterhaltung zusammenfassen' },
  cmdOwlsGist: { en: 'the owl’s gist', de: 'die Eule fasst zusammen' },
  cmdAcceptTask: { en: 'Accept found task', de: 'Gefundene Aufgabe übernehmen' },
  cmdGoInbox: { en: 'Go to Inbox', de: 'Zum Posteingang' },
  cmdGoWaiting: { en: 'Go to Waiting', de: 'Zu „Ausstehend“' },
  cmdGoTasks: { en: 'Go to Tasks', de: 'Zu „Aufgaben“' },
  cmdOpen: { en: '{n} open', de: '{n} offen' },
  cmdYourStyle: { en: 'Your style', de: 'Dein Stil' },
  cmdOnePerAddress: { en: 'one per address', de: 'einer pro Adresse' },
  cmdFilterAll: { en: 'Filter: all accounts', de: 'Filter: alle Konten' },
  cmdFilterOnly: { en: 'Filter: {name} only', de: 'Filter: nur {name}' },
  cmdOpenSettings: { en: 'Open Settings', de: 'Einstellungen öffnen' },
  cmdSettingsNote: { en: 'accounts · key · models', de: 'Konten · Schlüssel · Modelle' },
  cmdRefresh: { en: 'Check for new email', de: 'Nach neuen E-Mails suchen' },
  cmdRefreshNote: { en: 'all accounts · incl. spam', de: 'alle Konten · inkl. Spam' },
  refreshTitle: { en: 'Check for new email now', de: 'Jetzt nach neuen E-Mails suchen' },
  toastRefreshing: { en: 'Checking all accounts…', de: 'Alle Konten werden abgeglichen…' },
  cmdAddAddress: { en: 'Add an email address', de: 'E-Mail-Adresse hinzufügen' },
  cmdProviders: { en: 'Google · Microsoft · IMAP', de: 'Google · Microsoft · IMAP' },
  cmdChooseModels: { en: 'Choose models', de: 'Modelle wählen' },
  cmdShortcuts: { en: 'Show keyboard shortcuts', de: 'Tastenkürzel anzeigen' },
  cmdReplayOnboarding: { en: 'Replay onboarding', de: 'Einführung wiederholen' },
  cmdCompose: { en: 'New email', de: 'Neue E-Mail' },
  cmdOwlSearch: { en: 'Search & ask the owl', de: 'Suchen & die Eule fragen' },
  cmdOwlSearchNote: { en: 'email search lives here now', de: 'die E-Mail-Suche ist jetzt hier' },
  cmdLanguage: { en: 'Sprache: Deutsch', de: 'Language: English' },

  // ── Hilfe ──
  helpTitle: { en: 'Keyboard', de: 'Tastatur' },
  helpSub: {
    en: 'EVERYTHING WORKS WITHOUT THE MOUSE · ESC TO CLOSE',
    de: 'ALLES GEHT OHNE MAUS · ESC ZUM SCHLIESSEN'
  },
  helpMove: { en: 'move through the list', de: 'in der Liste navigieren' },
  helpDictate: {
    en: 'dictate a reply — the hero move (also: v)',
    de: 'Antwort diktieren – der Königsweg (auch: v)'
  },
  helpFile: {
    en: 'archive · edits an open draft',
    de: 'archivieren · bearbeitet einen offenen Entwurf'
  },
  helpEnter: { en: 'finish dictation / run command', de: 'Diktat beenden / Befehl ausführen' },
  helpSend: { en: 'send draft / nudge', de: 'Entwurf bzw. Stups senden' },
  helpReply: { en: 'reply by typing (list)', de: 'Antwort schreiben (Liste)' },
  helpReplyAll: { en: 'reply to all (list)', de: 'allen antworten (Liste)' },
  helpReplyScopeToggle: {
    en: 'switch reply scope (in the editor)',
    de: 'Empfänger der Antwort umschalten (im Editor)'
  },
  helpRedraft: { en: 'redraft — another take', de: 'neu entwerfen – andere Fassung' },
  helpIdeaToMail: { en: 'idea → email (in the composer)', de: 'Idee → E-Mail (beim Schreiben)' },
  sigImgReadError: { en: 'Could not read the image', de: 'Das Bild konnte nicht gelesen werden' },
  sigGreetingFallback: { en: 'Best regards', de: 'Viele Grüße' },
  helpTask: { en: 'accept / dismiss a found task', de: 'gefundene Aufgabe übernehmen / verwerfen' },
  helpOverride: {
    en: 'set category — overrides the owl',
    de: 'Kategorie festlegen – überstimmt die Eule'
  },
  helpSummarize: { en: 'summarize thread', de: 'Unterhaltung zusammenfassen' },
  helpUndo: { en: 'undo the last archive', de: 'letztes Archivieren rückgängig machen' },
  helpFilter: { en: 'filter by account · 0 shows all', de: 'nach Konto filtern · 0 zeigt alle' },
  helpPalette: { en: 'commands', de: 'Befehle' },
  helpViews: {
    en: 'go straight to inbox · waiting · tasks · calendar',
    de: 'direkt zu Posteingang · Ausstehend · Aufgaben · Kalender'
  },
  helpSettings: {
    en: 'settings — accounts · key · models',
    de: 'Einstellungen – Konten · Schlüssel · Modelle'
  },
  helpSignoff: {
    en: 'The owl works while you sleep.',
    de: 'Die Eule arbeitet, während du schläfst.'
  },

  // ── Toasts ──
  toastFiled: { en: 'Archived.', de: 'Archiviert.' },
  toastNothingUndo: { en: 'Nothing to undo', de: 'Nichts rückgängig zu machen' },
  toastBackInbox: { en: 'Back in the inbox', de: 'Zurück im Posteingang' },
  toastTaskAdded: { en: 'Task added — {label}', de: 'Aufgabe übernommen – {label}' },
  toastTaskUpdateFailed: {
    en: 'Task could not be updated',
    de: 'Die Aufgabe konnte nicht aktualisiert werden'
  },
  toastTaskDismissed: {
    en: 'Dismissed — the owl won’t mention it again',
    de: 'Verworfen – die Eule erwähnt es nicht wieder'
  },
  toastNudgeSent: {
    en: 'Nudge sent to {name} — in your voice, gently',
    de: 'Stups an {name} gesendet – freundlich und in deinem Stil'
  },
  toastStopWaiting: { en: 'Stopped waiting on {name}', de: 'Du wartest nicht mehr auf {name}' },
  toastOwlGist: { en: 'The owl: {gist}', de: 'Die Eule: {gist}' },
  toastNoQuestion: {
    en: 'Nothing to answer here — the owl found no question for you.',
    de: 'Hier gibt es nichts zu beantworten – die Eule hat keine Frage an dich gefunden.'
  },
  toastVoiceRefreshed: {
    en: 'Voice refreshed — the owl reread your sent emails',
    de: 'Stil aktualisiert – die Eule hat deine gesendeten E-Mails neu gelesen'
  },
  toastKeySaved: {
    en: '✓ Key saved locally — the owl wakes up',
    de: '✓ Schlüssel lokal gespeichert – die Eule wacht auf'
  },
  toastKeyInvalid: {
    en: 'That doesn’t look like an OpenRouter key (sk-or-…)',
    de: 'Das sieht nicht nach einem OpenRouter-Schlüssel aus (sk-or-…)'
  },
  toastScanModel: { en: 'Scanning now runs on {model}', de: 'Scannen läuft jetzt mit {model}' },
  toastScanApple: {
    en: 'Scanning now runs on-device (Apple Intelligence)',
    de: 'Scannen läuft jetzt auf dem Gerät (Apple Intelligence)'
  },
  fmProviderCloud: { en: 'OpenRouter (cloud)', de: 'OpenRouter (Cloud)' },
  fmProviderApple: {
    en: 'Apple Intelligence — on this Mac',
    de: 'Apple Intelligence – auf diesem Mac'
  },
  fmProviderAppleSub: {
    en: 'triage runs on-device, email text never leaves this machine — tasks only for clear personal requests',
    de: 'Die Vorsortierung läuft auf dem Gerät, der Text der E-Mails verlässt den Rechner nicht – Aufgaben nur bei klarer persönlicher Bitte'
  },
  fmStateAvailable: { en: 'available', de: 'verfügbar' },
  fmStateOff: {
    en: 'Apple Intelligence is turned off in System Settings',
    de: 'Apple Intelligence ist in den Systemeinstellungen ausgeschaltet'
  },
  fmStateNotReady: {
    en: 'model is still downloading — try again later',
    de: 'Das Modell wird noch geladen – versuche es später erneut'
  },
  fmStateUnsupported: {
    en: 'needs macOS 26 on Apple Silicon',
    de: 'benötigt macOS 26 auf einem Mac mit Apple Silicon'
  },
  fmStateHelperMissing: {
    en: 'helper not built — run: pnpm run build:fm',
    de: 'Hilfsprogramm nicht gebaut – führe pnpm run build:fm aus'
  },
  fmStateError: { en: 'check failed', de: 'Prüfung fehlgeschlagen' },
  fmCloudDimmed: {
    en: 'cloud model unused while Apple Intelligence handles scanning',
    de: 'Cloud-Modell pausiert, solange Apple Intelligence scannt'
  },
  toastWriteModel: { en: 'Drafts now written by {model}', de: 'Entwürfe schreibt jetzt {model}' },
  toastConnected: {
    en: '✓ {addr} connected — the owl starts learning that style',
    de: '✓ {addr} verbunden – die Eule lernt jetzt diesen Stil'
  },
  toastDisconnected: { en: '{addr} disconnected', de: '{addr} getrennt' },
  toastImapFields: {
    en: 'Enter an address, host and app password',
    de: 'Es fehlen Adresse, Host oder App-Passwort'
  },
  toastConnectOne: { en: 'Connect at least one address', de: 'Verbinde mindestens eine Adresse' },
  toastWelcome: {
    en: 'Welcome. Press ? for the keys — or just start with j and k.',
    de: 'Willkommen. Drück ? für die Tastenkürzel – oder starte einfach mit j und k.'
  },
  toastLangSwitched: { en: 'Language: English', de: 'Sprache: Deutsch' },

  // ── Onboarding ──
  obTagline: {
    en: 'EMAIL, WITH AN OWL ON YOUR SHOULDER',
    de: 'E-MAIL MIT EINER EULE AUF DER SCHULTER'
  },
  obIntro: {
    en: 'It reads with you, drafts in your voice, remembers who owes you a reply, and turns requests into tasks. You keep your hands on the keyboard — or just talk.',
    de: 'Sie liest mit, entwirft Antworten in deinem Stil, merkt sich, wer dir noch eine Antwort schuldet, und verwandelt Bitten in Aufgaben. Deine Hände bleiben auf der Tastatur – oder du sprichst einfach.'
  },
  obConnectCta: { en: 'CONNECT AN EMAIL ACCOUNT — ↵', de: 'E-MAIL-KONTO VERBINDEN – ↵' },
  obSkip: { en: 'skip for now', de: 'vorerst überspringen' },
  obStep2: { en: 'STEP 2 OF 4', de: 'SCHRITT 2 VON 4' },
  obStep3: { en: 'STEP 3 OF 4 — THE OWL’S EYES', de: 'SCHRITT 3 VON 4 – DIE AUGEN DER EULE' },
  obStep4: { en: 'STEP 4 OF 4 — YOUR VOICE', de: 'SCHRITT 4 VON 4 – DEIN STIL' },
  obConnectHead: { en: 'Connect your email accounts', de: 'Verbinde deine E-Mail-Konten' },
  obConnectSub: {
    en: 'Noctua works with Gmail, Outlook and any IMAP account. Everything is indexed locally.',
    de: 'Noctua versteht Gmail, Outlook und IMAP. Alles wird lokal indexiert.'
  },
  obConnect: { en: 'CONNECT', de: 'VERBINDEN' },
  obConnected: { en: 'CONNECTED', de: 'VERBUNDEN' },
  obContinue: { en: 'CONTINUE — ↵', de: 'WEITER – ↵' },
  obNothingLeaves: { en: 'nothing leaves your machine', de: 'nichts verlässt deinen Rechner' },
  obNConnected: { en: '{n} connected — indexed locally', de: '{n} verbunden – lokal indexiert' },
  obVoiceHead: { en: 'The owl learns your voice', de: 'Die Eule lernt deinen Stil' },
  obVoiceSub: {
    en: 'It studies what you’ve sent — per address — so drafts sound like you, not like a machine.',
    de: 'Sie liest, was du bisher gesendet hast – pro Adresse –, damit Entwürfe nach dir klingen und nicht nach Maschine.'
  },
  obReading: { en: 'reading your sent replies…', de: 'liest deine gesendeten Antworten…' },
  obDone: { en: 'DONE', de: 'FERTIG' },
  obEnterCta: { en: 'GO TO YOUR INBOX — ↵', de: 'ZUM POSTEINGANG – ↵' },
  obRetrainNote: {
    en: 'you can retrain any time under STYLE',
    de: 'du kannst den Stil jederzeit unter STIL neu lernen lassen'
  },

  // ── Onboarding — Schlüssel-Schritt + pausiertes Training (Design 1b) ──
  obOrgHead: { en: 'Your organization’s AI', de: 'Die KI deiner Organisation' },
  obOrgSub: {
    en: 'Gists, tasks and drafts run on the AI profiles your organization provides. Add your key where one is needed.',
    de: 'Kurzfassungen, Aufgaben und Entwürfe laufen über die KI-Profile deiner Organisation. Hinterlege deinen Schlüssel, wo einer nötig ist.'
  },
  obOrgProfilesLabel: {
    en: 'AI PROFILES FROM YOUR ORGANIZATION',
    de: 'KI-PROFILE DEINER ORGANISATION'
  },
  obOrgNoProfiles: {
    en: 'No AI profiles provided — the owl stays paused. You can add one in Settings → AI.',
    de: 'Keine KI-Profile bereitgestellt – die Eule bleibt pausiert. Du kannst unter Einstellungen → KI eines anlegen.'
  },
  obOrgKeySaved: { en: '✓ key saved', de: '✓ Schlüssel gespeichert' },
  obOrgNoKeyNeeded: { en: 'local — no key needed', de: 'lokal – kein Schlüssel nötig' },
  obKeyLabel: { en: 'OPENROUTER API KEY', de: 'OPENROUTER-API-SCHLÜSSEL' },
  obKeySave: { en: 'SAVE — ↵', de: 'SPEICHERN – ↵' },
  obKeyFootnotePre: { en: 'no account yet? ', de: 'noch kein Konto? ' },
  obKeyFootnotePost: {
    en: ' — a few cents cover a busy week',
    de: ' – ein paar Cent reichen für eine ganze Woche'
  },
  obKeyModelsNote: {
    en: 'MODELS COME WITH SENSIBLE DEFAULTS — CHANGE THEM ANYTIME IN SETTINGS → AI',
    de: 'MODELLE HABEN SINNVOLLE VORGABEN – JEDERZEIT ÄNDERBAR UNTER EINSTELLUNGEN → KI'
  },
  obTrainCta: { en: 'TRAIN MY VOICE — ↵', de: 'STIL LERNEN – ↵' },
  obKeySkip: {
    en: 'skip — the owl sleeps until then',
    de: 'überspringen – bis dahin schläft die Eule'
  },
  obPausedNoKey: { en: 'PAUSED — NO KEY', de: 'PAUSIERT – KEIN SCHLÜSSEL' },
  obFailed: { en: 'FAILED —', de: 'FEHLGESCHLAGEN –' },
  obRetry: { en: 'RETRY', de: 'ERNEUT VERSUCHEN' },
  obPausedCallout: {
    en: 'The owl can’t read without its eyes. Add the key and training runs on its own.',
    de: 'Ohne ihre Augen kann die Eule nicht lesen. Hinterlege den Schlüssel, dann läuft das Training von allein.'
  },
  obAddKey: { en: 'ADD KEY', de: 'SCHLÜSSEL HINTERLEGEN' },
  obPausedFootnote: {
    en: 'email works without a key — the owl just sleeps',
    de: 'E-Mail funktioniert auch ohne Schlüssel – nur die Eule schläft'
  },

  // ── Onboarding — KI-Schritt „Wo soll die KI laufen?" (lokal zuerst) ──
  obAiHead: { en: 'Where should the AI run?', de: 'Wo soll die KI laufen?' },
  obAiSub: {
    en: 'The owl reads your email to sort it and write drafts. Choose where that happens — you can change it anytime in Settings → AI.',
    de: 'Die Eule liest deine E-Mails, um sie zu sortieren und Entwürfe zu schreiben. Wähle, wo das passiert – du kannst es jederzeit unter Einstellungen → KI ändern.'
  },
  obAiLocalTitle: { en: 'Local server', de: 'Lokaler Server' },
  obAiRecommended: { en: 'RECOMMENDED', de: 'EMPFOHLEN' },
  obAiLocalSub: {
    en: 'Ollama, LM Studio or similar on this machine — your email never leaves it.',
    de: 'Ollama, LM Studio o. Ä. auf diesem Rechner – deine E-Mails verlassen ihn nie.'
  },
  obAiAppleTitle: {
    en: 'Apple Intelligence (on this Mac)',
    de: 'Apple Intelligence (auf dem Mac)'
  },
  obAiAppleSub: {
    en: 'Sorts your inbox with Apple Intelligence, entirely on this Mac.',
    de: 'Sortiert deinen Posteingang mit Apple Intelligence, komplett auf diesem Mac.'
  },
  obAiAppleNote: {
    en: 'Drafting needs a local server or a cloud provider — add one later in Settings → AI.',
    de: 'Für Entwürfe brauchst du einen lokalen Server oder einen Cloud-Anbieter – den kannst du später unter Einstellungen → KI hinzufügen.'
  },
  obAiCloudTitle: { en: 'Cloud provider', de: 'Cloud-Anbieter' },
  obAiCloudSub: {
    en: 'OpenRouter or any OpenAI-compatible service.',
    de: 'OpenRouter oder ein anderer OpenAI-kompatibler Dienst.'
  },
  obAiCloudOther: { en: 'Other (OpenAI-compatible)', de: 'Anderer Anbieter (OpenAI-kompatibel)' },
  obAiCloudPrivacy: {
    en: 'Heads-up: with a cloud provider, the content of your emails is sent to that provider.',
    de: 'Hinweis: Bei einem Cloud-Anbieter wird der Inhalt deiner E-Mails an diesen Anbieter gesendet.'
  },
  obAiSkipTitle: {
    en: 'Skip — use Noctua as a plain email client',
    de: 'Überspringen – Noctua als reinen E-Mail-Client nutzen'
  },
  obAiSkipSub: {
    en: 'No AI for now. You can set it up later in Settings → AI.',
    de: 'Vorerst ohne KI. Du kannst sie später unter Einstellungen → KI einrichten.'
  },
  obAiDetecting: { en: 'looking for local servers…', de: 'suche nach lokalen Servern…' },
  obAiFoundLabel: { en: 'FOUND ON THIS MACHINE', de: 'AUF DIESEM RECHNER GEFUNDEN' },
  obAiModelOne: { en: '1 model', de: '1 Modell' },
  obAiModelMany: { en: '{n} models', de: '{n} Modelle' },
  obAiKindOther: { en: 'LocalAI / vLLM', de: 'LocalAI / vLLM' },
  obAiNoneFound: {
    en: 'No local server found. Start Ollama or LM Studio, or enter its address.',
    de: 'Kein lokaler Server gefunden. Starte Ollama oder LM Studio oder gib die Adresse ein.'
  },
  obAiSearchAgain: { en: 'search again', de: 'erneut suchen' },
  obAiOtherAddress: { en: 'use another address', de: 'andere Adresse verwenden' },
  obAiUrlLabel: { en: 'SERVER ADDRESS', de: 'SERVERADRESSE' },
  obAiKeyOptional: { en: 'API KEY (OPTIONAL)', de: 'API-SCHLÜSSEL (OPTIONAL)' },
  obAiTest: { en: 'TEST', de: 'TESTEN' },
  obAiTestOk: { en: '✓ connected — {n} models', de: '✓ verbunden – {n} Modelle' },
  obAiScanLabel: { en: 'INBOX SCANNING', de: 'POSTEINGANG SORTIEREN' },
  obAiWriteLabel: { en: 'WRITING', de: 'SCHREIBEN' },
  obAiModelsAuto: {
    en: 'We picked a small, fast model for scanning and your largest for writing — change them if you like.',
    de: 'Zum Sortieren haben wir ein kleines, schnelles Modell gewählt, zum Schreiben dein größtes – du kannst beides ändern.'
  },
  obAiNotLocal: {
    en: 'This address is neither on this machine nor in your network — with Local only on, it is blocked.',
    de: 'Diese Adresse liegt weder auf diesem Rechner noch in deinem Netzwerk – bei aktivem „Nur lokal“ wird sie blockiert.'
  },
  obAiDictation: { en: 'Dictation (optional)', de: 'Diktat (optional)' },
  obAiDictWhisper: { en: 'Whisper server', de: 'Whisper-Server' },
  obAiDictNone: { en: 'not now', de: 'vorerst nicht' },
  obAiWhisperUrl: { en: 'Whisper server address', de: 'Whisper-Serveradresse' },
  obAiWhisperModel: { en: 'Whisper model', de: 'Whisper-Modell' },
  obAiLocalOnly: { en: 'LOCAL ONLY', de: 'NUR LOKAL' },
  obAiLocalOnlyNote: {
    en: 'The AI then uses only local providers, and nothing is fetched from the internet automatically.',
    de: 'Die KI nutzt dann nur lokale Anbieter, und aus dem Internet wird nichts automatisch geladen.'
  },
  obAiLocalOnlyCloud: {
    en: 'With Local only on, a cloud provider stays blocked until you switch it off.',
    de: 'Bei aktivem „Nur lokal“ bleibt ein Cloud-Anbieter gesperrt, bis du es ausschaltest.'
  },
  obAiContinueSkip: { en: 'CONTINUE WITHOUT AI', de: 'OHNE KI WEITER' },
  obAiPausedNoAi: { en: 'PAUSED — NO AI', de: 'PAUSIERT – KEINE KI' },
  obAiPausedCallout: {
    en: 'The owl needs an AI to read and write. Set one up and training runs on its own.',
    de: 'Die Eule braucht eine KI zum Lesen und Schreiben. Richte eine ein, und das Training läuft von allein.'
  },
  obAiPausedCalloutApple: {
    en: 'Apple Intelligence can sort your inbox, but drafting — and so voice training — needs a local server or a cloud provider.',
    de: 'Apple Intelligence kann deinen Posteingang sortieren, aber für Entwürfe – und damit das Lernen deines Stils – brauchst du einen lokalen Server oder einen Cloud-Anbieter.'
  },
  obAiSetUp: { en: 'SET UP AI', de: 'KI EINRICHTEN' },
  obAiPausedFootnote: {
    en: 'email works without AI — the owl just sleeps',
    de: 'E-Mail funktioniert auch ohne KI – nur die Eule schläft'
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
    de: 'Absender: {name} – Konto auswählen'
  },
  composeAutoSwitched: {
    en: '↳ switched to {name} — last used for {addr}',
    de: '↳ zu {name} gewechselt – zuletzt für {addr} verwendet'
  },
  composeDoubtfulAddr: {
    en: 'This address looks unusual — the domain has no dot. You can still send.',
    de: 'Die Adresse sieht ungewöhnlich aus – der Domain fehlt ein Punkt. Du kannst trotzdem senden.'
  },
  composeNoSubject: { en: 'NO SUBJECT', de: 'OHNE BETREFF' },
  composeDraftFiled: {
    en: 'Draft saved — NEW EMAIL brings it back',
    de: 'Entwurf gespeichert – „Neue E-Mail“ holt ihn zurück'
  },
  composeChipRemove: { en: 'Remove {addr}', de: '{addr} entfernen' },

  mboxInbox: { en: 'INBOX', de: 'POSTEINGANG' },
  mboxSent: { en: 'SENT', de: 'GESENDET' },
  mboxSpam: { en: 'SPAM', de: 'SPAM' },
  mboxSentNote: {
    en: 'Sent by you. If it awaits a reply, you’ll find it under WAITING.',
    de: 'Von dir gesendet. Wenn sie auf eine Antwort wartet, findest du sie unter AUSSTEHEND.'
  },
  mboxSpamNote: {
    en: 'Sorted out by the owl — links here are disarmed.',
    de: 'Von der Eule aussortiert – Links sind hier deaktiviert.'
  },
  echoSending: { en: 'SENDING', de: 'WIRD GESENDET' },
  echoSendFailed: { en: 'SEND FAILED', de: 'NICHT GESENDET' },
  echoSendUnknown: { en: 'MAY HAVE BEEN SENT', de: 'VIELLEICHT GESENDET' },
  echoSendUnknownHint: {
    en: 'May have been sent — check Sent folder',
    de: 'Möglicherweise gesendet – sieh im Ordner „Gesendet“ nach'
  },
  composeDraftRestored: { en: 'Draft restored', de: 'Entwurf wiederhergestellt' },
  // ── Terminvorschläge aus Mails (AI) ──
  eventSuggestHead: { en: 'ADD TO CALENDAR?', de: 'IN DEN KALENDER EINTRAGEN?' },
  eventSuggestProposed: { en: 'PROPOSED', de: 'VORSCHLAG' },
  eventSuggestConfirmed: { en: 'CONFIRMED', de: 'BESTÄTIGT' },
  eventSuggestWhen: { en: 'When', de: 'Wann' },
  eventSuggestWhere: { en: 'Where', de: 'Wo' },
  eventSuggestAdd: { en: 'Add', de: 'Hinzufügen' },
  eventSuggestEdit: { en: 'Edit…', de: 'Bearbeiten…' },
  eventSuggestDismiss: { en: 'Dismiss', de: 'Verwerfen' },
  eventSuggestAdded: { en: 'Added to your calendar', de: 'Zum Kalender hinzugefügt' },
  eventSuggestOpen: { en: 'Open in calendar', de: 'Im Kalender öffnen' },
  eventSuggestNoCalendar: { en: 'No writable calendar', de: 'Kein Kalender mit Schreibzugriff' },
  toastEventAdded: { en: 'Event added — {title}', de: 'Termin hinzugefügt – {title}' },
  toastEventAddFailed: {
    en: 'Event could not be added',
    de: 'Der Termin konnte nicht hinzugefügt werden'
  },
  draftCalendarHead: { en: 'AVAILABILITY IN DRAFTS', de: 'VERFÜGBARKEIT IN ENTWÜRFEN' },
  draftCalendarSub: {
    en: 'Reply drafts can propose free slots',
    de: 'Antwortentwürfe können freie Zeiten vorschlagen'
  },
  draftCalendarToggle: {
    en: 'Use my calendar for meeting requests',
    de: 'Meinen Kalender bei Terminanfragen nutzen'
  },
  draftCalendarNoteOn: {
    en: 'Only free time slots (no titles, places or attendees) go into the prompt — and to the AI provider you chose.',
    de: 'Nur freie Zeitfenster (keine Titel, Orte oder Teilnehmende) gehen in den Prompt – und damit an den gewählten KI-Anbieter.'
  },
  draftCalendarNoteOff: {
    en: 'Drafts never see your calendar.',
    de: 'Entwürfe sehen deinen Kalender nie.'
  },
  draftCalendarNoAccount: {
    en: 'Takes effect once a calendar account is connected.',
    de: 'Wirkt, sobald ein Kalender verbunden ist.'
  },

  tasksAutoHead: { en: 'TASKS FROM EMAIL', de: 'AUFGABEN AUS E-MAILS' },
  tasksAutoSub: {
    en: 'The owl spots to-dos while reading',
    de: 'Die Eule erkennt To-dos beim Lesen'
  },
  tasksAutoToggle: { en: 'Create tasks automatically', de: 'Aufgaben automatisch anlegen' },
  tasksAutoNoteOn: {
    en: 'Found tasks go straight to your list.',
    de: 'Gefundene Aufgaben landen direkt in deiner Liste.'
  },
  tasksAutoNoteOff: {
    en: 'Suggestion in the email only — accept with T.',
    de: 'Nur als Vorschlag in der E-Mail – übernehmen mit T.'
  },

  // ── Regeln (Design 3c — Letterpress) ──
  rulesHead: { en: 'Rules', de: 'Regeln' },
  rulesSub: {
    en: 'describe it in a sentence — the owl builds the rule',
    de: 'beschreibe sie in einem Satz – die Eule baut die Regel'
  },
  rulesPlaceholder: {
    en: 'e.g. “always archive Hetzner invoices and make a task”',
    de: 'z. B. „Hetzner-Rechnungen immer archivieren und als Aufgabe anlegen“'
  },
  rulesDraftBtn: { en: 'DRAFT — ↵', de: 'VORSCHLAG – ↵' },
  rulesDrafting: { en: 'THINKING…', de: 'DENKT NACH…' },
  rulesShowJson: { en: 'SHOW RULE JSON ▸', de: 'REGEL-JSON ANZEIGEN ▸' },
  rulesHideJson: { en: 'HIDE RULE JSON ▾', de: 'REGEL-JSON AUSBLENDEN ▾' },
  rulesActivate: { en: 'ACTIVATE RULE', de: 'REGEL AKTIVIEREN' },
  rulesDiscard: { en: 'DISCARD', de: 'VERWERFEN' },
  rulesActive: { en: 'Active', de: 'Aktiv' },
  rulesInactive: { en: 'Inactive', de: 'Inaktiv' },
  rulesHits: { en: '{n} hits so far', de: 'bisher {n} Treffer' },
  rulesDelete: { en: 'Delete rule', de: 'Regel löschen' },
  rulesEmpty: {
    en: 'No rules yet. Describe one above — the owl builds it.',
    de: 'Noch keine Regeln. Beschreibe oben eine – die Eule baut daraus eine feste Regel.'
  },
  syncRangeLabel: { en: 'SYNC RANGE', de: 'SYNC-ZEITRAUM' },
  syncRangeStd: {
    en: 'Default — 90 days (search: 6 months)',
    de: 'Standard – 90 Tage (Suche: 6 Monate)'
  },
  syncRange30: { en: 'Last 30 days', de: 'Letzte 30 Tage' },
  syncRange90: { en: 'Last 90 days', de: 'Letzte 90 Tage' },
  syncRange365: { en: 'Last year', de: 'Letztes Jahr' },
  syncRangeAll: { en: 'Everything', de: 'Alles' },
  syncRangeDays: { en: '{n} days', de: '{n} Tage' },
  toastSyncRange: {
    en: 'Sync range saved — adjusting in the background',
    de: 'Zeitraum gespeichert – wird im Hintergrund angepasst'
  },
  notSpamBtn: { en: 'NOT SPAM → INBOX', de: 'KEIN SPAM → POSTEINGANG' },
  cmdFolderInbox: { en: 'Folder: Inbox', de: 'Ordner: Posteingang' },
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
  sigBlocksHint: { en: 'click to add or remove', de: 'zum Hinzufügen oder Entfernen anklicken' },
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
    de: 'so sehen es die Empfänger von {addr}'
  },
  sigPreviewBody: {
    en: '… I will get back to you on Thursday with the details.',
    de: '… ich melde mich am Donnerstag mit den Details.'
  },
  sigImgHint: { en: 'click or drop an image', de: 'Bild anklicken oder hineinziehen' },
  sigImgBorder: { en: 'BORDER', de: 'RAHMEN' },
  sigImgPadding: { en: 'PADDING', de: 'ABSTAND' },
  sigImgBackground: { en: 'BACKGROUND', de: 'HINTERGRUND' },
  sigImgBackgroundTransparent: { en: 'Transparent', de: 'Transparent' },
  // Kuratierte Swatches statt OS-Farbwähler (Design 3f)
  sigSwatchPaper: { en: 'Paper', de: 'Papier' },
  sigSwatchPastel: { en: 'Pastel {hex}', de: 'Pastell {hex}' },
  sigSwatchInk: { en: 'Ink', de: 'Tinte' },
  sigSwatchCustom: { en: 'Saved color {hex}', de: 'Gespeicherte Farbe {hex}' },
  sigImgFootnote: {
    en: 'WITH AN IMAGE THE EMAIL IS SENT AS HTML · WITHOUT ONE, AS PLAIN TEXT',
    de: 'MIT BILD WIRD DIE E-MAIL ALS HTML GESENDET · OHNE BILD ALS REINER TEXT'
  },
  sigGreetingFootnote: {
    en: 'The closing line comes from your learned style, not from the signature.',
    de: 'Die Grußformel stammt aus deinem gelernten Stil, nicht aus der Signatur.'
  },
  sigBlock_name: { en: 'NAME', de: 'NAME' },
  sigBlock_title: { en: 'TITLE', de: 'POSITION' },
  sigBlock_studio: { en: 'COMPANY', de: 'FIRMA' },
  sigBlock_phone: { en: 'PHONE', de: 'TELEFON' },
  sigBlock_website: { en: 'WEBSITE', de: 'WEBSEITE' },
  sigBlock_address: { en: 'ADDRESS', de: 'ANSCHRIFT' },
  sigBlock_claim: { en: 'TAGLINE', de: 'SLOGAN' },
  sigBlock_rule: { en: 'DIVIDER', de: 'TRENNLINIE' },
  sigBlock_img: { en: 'IMAGE', de: 'BILD' },
  cmdFolderSpam: { en: 'Folder: Spam', de: 'Ordner: Spam' },
  cmdFolderSpamNote: { en: 'the owl pre-sorts', de: 'die Eule sortiert vor' },
  toName: { en: 'To: {name}', de: 'An: {name}' },
  quoteShow: { en: 'show earlier messages', de: 'frühere Nachrichten anzeigen' },
  quoteHide: { en: 'hide earlier messages', de: 'frühere Nachrichten ausblenden' },
  mailAttachmentOne: { en: '1 ATTACHMENT', de: '1 ANHANG' },
  mailAttachmentMany: { en: '{count} ATTACHMENTS', de: '{count} ANHÄNGE' },
  mailAttachmentsLoading: { en: 'LOADING ATTACHMENTS', de: 'ANHÄNGE WERDEN GELADEN' },
  mailAttachmentsTotal: { en: 'TOTAL {size}', de: 'GESAMT {size}' },
  mailAttachmentUnknown: { en: 'Unnamed attachment', de: 'Unbenannter Anhang' },
  mailAttachmentSave: { en: 'SAVE', de: 'SPEICHERN' },
  mailAttachmentSaving: { en: 'SAVING', de: 'WIRD GESPEICHERT' },
  mailAttachmentSaved: { en: 'SAVED', de: 'GESPEICHERT' },
  mailAttachmentRetry: { en: 'TRY AGAIN', de: 'NOCHMAL' },
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
  composeHead: { en: 'New email', de: 'Neue E-Mail' },
  composeSub: {
    en: 'THE OWL WRITES IN THIS ADDRESS’S VOICE',
    de: 'DIE EULE SCHREIBT IM STIL DIESER ADRESSE'
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
    de: 'Entfernte Empfänger wiederherstellen'
  },
  replyNoRecipient: {
    en: 'nobody — add a recipient with +',
    de: 'niemand – füge über + einen Empfänger hinzu'
  },
  replyAllToggleAria: {
    en: 'reply to all — {n} more recipients',
    de: 'allen antworten – {n} weitere Empfänger'
  },
  sendToN: { en: 'SEND TO {n}', de: 'AN {n} SENDEN' },
  toastReplyAllAlone: {
    en: 'No other recipients — the reply goes to the sender.',
    de: 'Keine weiteren Empfänger – die Antwort geht an den Absender.'
  },
  composerTranscribing: { en: 'PROCESSING DICTATION', de: 'DIKTAT WIRD VERARBEITET' },
  composerKeepsText: { en: 'YOUR TEXT STAYS IN PLACE', de: 'DEIN TEXT BLEIBT ERHALTEN' },
  composerGenerating: { en: 'THE OWL IS WRITING', de: 'DIE EULE FORMULIERT' },
  composerNoRecording: {
    en: 'No usable recording was found. You can keep typing.',
    de: 'Es wurde keine brauchbare Aufnahme erkannt. Du kannst einfach weiterschreiben.'
  },
  composerGenerationError: {
    en: 'The owl did not return a draft. Your original text is still here.',
    de: 'Die Eule hat keinen Entwurf geliefert. Dein ursprünglicher Text ist noch da.'
  },
  composerDictationInserted: { en: '✓ DICTATION INSERTED', de: '✓ DIKTAT EINGEFÜGT' },
  composerGenerated: { en: '✓ WRITTEN FROM YOUR TEXT', de: '✓ AUS DEINEM TEXT FORMULIERT' },
  composerRetry: { en: 'TRY AGAIN', de: 'ERNEUT VERSUCHEN' },
  composerDismiss: { en: 'DISMISS', de: 'SCHLIESSEN' },
  composerRestoreOriginal: { en: 'RESTORE ORIGINAL', de: 'ORIGINAL WIEDERHERSTELLEN' },
  composerSendReply: { en: 'SEND REPLY', de: 'ANTWORT SENDEN' },
  composerSendMessage: { en: 'SEND EMAIL', de: 'E-MAIL SENDEN' },
  composerSending: { en: 'SENDING…', de: 'WIRD GESENDET…' },
  composerGenerate: { en: 'WRITE WITH THE OWL', de: 'MIT DER EULE FORMULIEREN' },
  composerDictate: { en: 'DICTATE', de: 'DIKTIEREN' },
  composerFormat: { en: 'FORMAT', de: 'FORMAT' },
  composerDiscard: { en: 'DISCARD DRAFT', de: 'ENTWURF VERWERFEN' },
  toastInvalidLink: {
    en: 'Please enter a valid web or email address',
    de: 'Bitte gib eine gültige Web- oder E-Mail-Adresse ein'
  },
  toastNoRecipient: { en: 'Add at least one recipient', de: 'Gib mindestens einen Empfänger an' },
  toastNoIdea: {
    en: 'Type or dictate the idea first — ⌘J turns it into the email.',
    de: 'Gib zuerst die Idee ein oder diktiere sie – ⌘J macht daraus die E-Mail.'
  },
  toggleListLabel: { en: 'show/hide list', de: 'Liste ein-/ausblenden' },
  toggleRailLabel: { en: 'show/hide the owl', de: 'Eule ein-/ausblenden' },
  loading: { en: 'loading…', de: 'lädt…' },

  // ── Rechtschreibprüfung ──
  followupRadarHead: { en: 'FOLLOW-UP RADAR', de: 'NACHFASS-RADAR' },
  followupRadarSub: {
    en: 'when unanswered sent emails appear under WAITING',
    de: 'ab wann unbeantwortete gesendete E-Mails unter AUSSTEHEND erscheinen'
  },
  followupDays: { en: '{n} days silent', de: '{n} Tage ohne Antwort' },
  followupFewer: { en: 'Fewer days', de: 'Weniger Tage' },
  followupMore: { en: 'More days', de: 'Mehr Tage' },
  followupWindowNote: {
    en: 'window 3–21 days · applies at the next scan',
    de: 'Spanne 3–21 Tage · gilt ab dem nächsten Scan'
  },
  spellIgnore: { en: 'IGNORE', de: 'IGNORIEREN' },
  spellNoSuggestions: { en: 'no suggestions', de: 'keine Vorschläge' },

  // ── Technik-Seite: „Wie die Eule denkt" (Pipelines in Bildern) ──
  cmdTech: { en: 'How the owl thinks', de: 'Wie die Eule denkt' },
  cmdTechNote: { en: 'every pipeline, one picture', de: 'jeder Ablauf als Bild' },
  techHead: { en: 'How the owl thinks', de: 'Wie die Eule denkt' },
  techSub: {
    en: 'TEN PIPELINES, TEN PICTURES, ONE LIVE NETWORK LIST · NO MAGIC, JUST PLUMBING',
    de: 'ZEHN ABLÄUFE, ZEHN BILDER, EINE LIVE-NETZWERKLISTE · KEINE MAGIE, NUR HANDWERK'
  },
  techLegendSolid: { en: 'SOLID — ON YOUR DEVICE', de: 'DURCHGEZOGEN – AUF DEINEM GERÄT' },
  techLegendDashed: {
    en: 'DASHED — API CALL TO AN AI PROFILE',
    de: 'GESTRICHELT – API-AUFRUF AN EIN KI-PROFIL'
  },
  techLegendModel: { en: '✦ — A LANGUAGE MODEL', de: '✦ – EIN SPRACHMODELL' },
  techLegendNote: {
    en: 'Dashed lines only exist once an AI profile is set up (by default OpenRouter, with your key) — without one, the owl stays fully on paper. Which servers are actually contacted is listed at the bottom.',
    de: 'Gestrichelte Linien gibt es erst, wenn ein KI-Profil eingerichtet ist (standardmäßig OpenRouter mit deinem Schlüssel) – ohne Profil bleibt die Eule ganz auf dem Papier. Welche Server tatsächlich kontaktiert werden, steht ganz unten.'
  },

  // 01 · Triage
  techTriageTitle: { en: 'Triage — every new email', de: 'Vorsortierung – jede neue E-Mail' },
  techTriageIn: { en: 'NEW EMAIL', de: 'NEUE E-MAIL' },
  techTriageQueue: { en: 'QUEUE', de: 'WARTESCHLANGE' },
  techTriageBudget: { en: 'BUDGET GUARD', de: 'BUDGET-WÄCHTER' },
  techTriageBudgetNote1: { en: 'DAY & MONTH', de: 'TAG & MONAT' },
  techTriageBudgetNote2: { en: 'CAPPED', de: 'GEDECKELT' },
  techTriageModel: { en: 'SCAN MODEL', de: 'SCAN-MODELL' },
  techTriageModelNote: { en: 'DEEPSEEK · YOUR PICK', de: 'DEEPSEEK · WÄHLBAR' },
  techTriageCard: { en: 'ANNOTATION', de: 'ANMERKUNG' },
  techTriageRow1: { en: 'CATEGORY — WORK', de: 'KATEGORIE – ARBEIT' },
  techTriagePrio: { en: 'PRIORITY', de: 'PRIORITÄT' },
  techTriageGist: { en: '“The gist in one line.”', de: '„Der Kern in einer Zeile.“' },
  techTriageRow4: { en: 'REPLY? · TASKS · FOR ME?', de: 'ANTWORT? · AUFGABEN · AN MICH?' },
  techTriageSpam: {
    en: 'ONLY THE INBOX — SPAM IS NEVER READ',
    de: 'NUR DER POSTEINGANG – SPAM WIRD NIE GELESEN'
  },
  techTriageCap: {
    en: 'Every new inbox email gets one cheap read: category, priority, the one-liner — and whether it needs you. A budget guard caps the daily and monthly spend; when the budget is spent, the queue simply waits.',
    de: 'Jede neue E-Mail im Posteingang wird einmal günstig gelesen: Kategorie, Priorität, Zusammenfassung in einer Zeile – und ob sie dich braucht. Ein Budget-Wächter begrenzt die Kosten pro Tag und Monat; ist das Budget aufgebraucht, wartet die Warteschlange einfach.'
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
  techAddrTo: { en: 'I AM IN “TO”', de: 'ICH STEHE IM „AN“' },
  techAddrS3: { en: '3 · MODEL VERDICT', de: '3 · MODELL-URTEIL' },
  techAddrS3Sample: { en: 'ADDRESSED_TO_ME', de: 'ADDRESSED_TO_ME' },
  techAddrYes: { en: 'YES', de: 'JA' },
  techAddrNo: { en: 'NO', de: 'NEIN' },
  techAddrCreate: { en: 'CREATE TASK', de: 'AUFGABE ANLEGEN' },
  techAddrNone: { en: 'NOTHING', de: 'NICHTS' },
  techAddrSuggest: { en: 'SUGGEST ONLY', de: 'NUR VORSCHLAG' },
  techAddrCap: {
    en: 'A task only appears when you are truly meant: a salutation naming you beats the envelope, the envelope beats the model. And when the model doubts, the owl merely suggests — it never creates in silence.',
    de: 'Eine Aufgabe entsteht nur, wenn wirklich du gemeint bist: Eine Anrede mit deinem Namen schlägt den Umschlag, der Umschlag schlägt das Modell. Und wenn das Modell zweifelt, schlägt die Eule nur vor – nie legt sie etwas stillschweigend an.'
  },

  // 03 · Aufgaben-Sieb
  techSieveTitle: { en: 'The task sieve', de: 'Das Aufgaben-Sieb' },
  techSieveIn: { en: 'ACTION ITEMS FROM TRIAGE', de: 'KANDIDATEN AUS DER VORSORTIERUNG' },
  techSieve1: { en: 'AUTO-CREATE IS OFF', de: 'AUTOMATISCHES ANLEGEN IST AUS' },
  techSieve2: { en: 'CATEGORY WITHOUT TASKS', de: 'KATEGORIE OHNE AUFGABEN' },
  techSieve2b: { en: 'NEWSLETTER · PROMO · ALERTS', de: 'NEWSLETTER · WERBUNG · INFOS' },
  techSieve3: { en: 'SECURITY EMAIL', de: 'SICHERHEITS-E-MAIL' },
  techSieve3b: { en: 'LOGIN · 2FA · PASSWORD', de: 'LOGIN · 2FA · PASSWORT' },
  techSieve4: { en: 'NOT ADDRESSED TO ME', de: 'NICHT AN MICH GERICHTET' },
  techSieve4b: { en: 'CC · LIST · FOREIGN NAME', de: 'CC · VERTEILER · FREMDE ANREDE' },
  techSieve5: { en: 'WRITTEN BY MYSELF', de: 'VON MIR SELBST' },
  techSieve6: { en: 'FORWARD WITHOUT A REQUEST', de: 'WEITERLEITUNG OHNE BITTE' },
  techSieveSuggest: { en: 'IN DOUBT: SUGGEST ONLY', de: 'IM ZWEIFEL: NUR VORSCHLAG' },
  techSieveSuggestB: { en: 'SHOWN INSIDE THE EMAIL', de: 'ERSCHEINT IN DER E-MAIL' },
  techSieveTask: { en: 'TASK', de: 'AUFGABE' },
  techSieveTaskNote: { en: 'MAX 5 + “REPLY” TASK', de: 'MAX. 5 + „ANTWORTEN“' },
  techSieveCap: {
    en: 'Six sieves, in exactly this order — whatever gets caught is dropped, and in doubt the owl only suggests. Only what falls through all six becomes a task on its own.',
    de: 'Sechs Siebe in genau dieser Reihenfolge – was hängen bleibt, wird verworfen, und im Zweifel gibt es nur einen Vorschlag. Nur was durch alle sechs fällt, wird von selbst zur Aufgabe.'
  },

  // 04 · Semantische Suche
  techSearchTitle: { en: 'Search — text and meaning', de: 'Suche – Text und Bedeutung' },
  techSearchIn: { en: 'YOUR QUERY', de: 'DEINE SUCHE' },
  techSearchSample: { en: '“lease agreement”', de: '„mietvertrag“' },
  techSearchFts: { en: 'FULL TEXT — FTS5', de: 'VOLLTEXT – FTS5' },
  techSearchFtsNote: { en: 'BM25 RANKING', de: 'BM25-RANKING' },
  techSearchVec: { en: 'MEANING — VECTORS', de: 'BEDEUTUNG – VEKTOREN' },
  techSearchVecNote: { en: 'E5-SMALL · ON DEVICE', de: 'E5-SMALL · AUF DEM GERÄT' },
  techSearchFuse: { en: 'FUSION', de: 'FUSION' },
  techSearchFuseNote: { en: 'RRF', de: 'RRF' },
  techSearchHits: { en: 'HITS', de: 'TREFFER' },
  techSearchChip: { en: 'LOCAL · 0 TOKENS', de: 'LOKAL · 0 TOKENS' },
  techSearchCap: {
    en: 'Full text and meaning search in parallel; a rank fusion blends both lists. All of it runs on your device — the embedding model lives locally, costs no tokens, and its coverage shows in the owl’s footer.',
    de: 'Volltext- und Bedeutungssuche laufen parallel, eine Rang-Fusion mischt beide Listen. Alles läuft auf deinem Gerät – das Embedding-Modell liegt lokal, kostet keine Tokens, und die Abdeckung steht unten in der Eulen-Ansicht.'
  },

  // 05 · Die Eule fragen
  techAskTitle: { en: 'Ask the owl', de: 'Die Eule fragen' },
  techAskQ: { en: 'YOUR QUESTION', de: 'DEINE FRAGE' },
  techAskExpand: { en: 'SEARCH TERMS', de: 'SUCHBEGRIFFE' },
  techAskLocal: { en: 'LOCAL SEARCH', de: 'LOKALE SUCHE' },
  techAskLocalNote: { en: 'VECTOR + FULL TEXT', de: 'VEKTOR + VOLLTEXT' },
  techAskSources: { en: 'SOURCES', de: 'QUELLEN' },
  techAskModel: { en: 'WRITING MODEL', de: 'SCHREIB-MODELL' },
  techAskModelNote: { en: 'DEFAULT CLAUDE · YOUR PICK', de: 'STANDARD: CLAUDE · WÄHLBAR' },
  techAskAnswer: { en: 'STREAMED ANSWER', de: 'ANTWORT IM STREAM' },
  techAskStore: { en: 'STAYS IN SQLITE', de: 'BLEIBT IN SQLITE' },
  techAskStoreNote: { en: 'YOUR LOCAL DATABASE', de: 'DEINE LOKALE DATENBANK' },
  techAskCap: {
    en: 'A question first searches your email locally; only the question and the found excerpts travel to the model. The answer streams in with [n] citations — the conversation itself stays in your local database.',
    de: 'Eine Frage durchsucht zuerst lokal deine E-Mails; nur die Frage und die gefundenen Ausschnitte gehen an das Modell. Die Antwort kommt als Stream mit [n]-Zitaten – das Gespräch selbst bleibt in deiner lokalen Datenbank.'
  },

  // 06 · Entwürfe & Stimme
  techVoiceTitle: { en: 'Drafts & your voice', de: 'Entwürfe & dein Stil' },
  techVoiceSent1: { en: 'SENT', de: 'GESENDETE' },
  techVoiceSent2: { en: 'EMAILS', de: 'E-MAILS' },
  techVoiceProfile: { en: 'STYLE PROFILE', de: 'STILPROFIL' },
  techVoiceProfileNote: { en: 'ONE PER ADDRESS', de: 'EINES PRO ADRESSE' },
  techVoiceThread1: { en: 'THREAD WITH', de: 'VERLAUF MIT' },
  techVoiceThread2: { en: 'THIS PERSON', de: 'DIESER PERSON' },
  techVoiceFormal: { en: 'DU / SIE', de: 'DU / SIE' },
  techVoiceFormalNote1: { en: 'DETERMINISTIC', de: 'DETERMINISTISCH' },
  techVoiceFormalNote2: { en: 'BEATS THE PROFILE', de: 'SCHLÄGT DAS PROFIL' },
  techVoiceMic: { en: 'DICTATION', de: 'DIKTAT' },
  techVoiceStt: { en: 'TRANSCRIPTION', de: 'TRANSKRIPTION' },
  techVoiceModel: { en: 'DRAFT MODEL', de: 'ENTWURFS-MODELL' },
  techVoiceDraft: { en: 'DRAFT', de: 'ENTWURF' },
  techVoiceDraftNote: { en: 'IN YOUR VOICE', de: 'IN DEINEM STIL' },
  techVoiceSend: { en: 'YOU PRESS SEND', de: 'DU DRÜCKST SENDEN' },
  techVoiceSendNote: { en: 'ALWAYS BY HAND', de: 'IMMER VON HAND' },
  techVoiceCap: {
    en: 'The owl learns your voice per address from emails you sent; Du or Sie follows the actual thread with that person — deterministically, overriding the profile. And nothing ever sends itself: the last click is always yours.',
    de: 'Die Eule lernt deinen Stil pro Adresse aus deinen gesendeten E-Mails. Ob du duzt oder siezt, richtet sich nach dem tatsächlichen Verlauf mit der Person – deterministisch und vor dem Profil. Und es wird nie etwas von allein gesendet: Der letzte Klick gehört immer dir.'
  },

  // 07 · Rechtschreibprüfung
  techSpellTitle: { en: 'Spelling — offline, honest', de: 'Rechtschreibung – offline und ehrlich' },
  techSpellSample: { en: 'definately', de: 'Rechtschreibpürfung' },
  techSpellEngine: { en: 'HUNSPELL · WASM', de: 'HUNSPELL · WASM' },
  techSpellDictNote: { en: 'BUNDLED LOCALLY', de: 'LOKAL MITGELIEFERT' },
  techSpellSuggest: { en: 'SUGGESTIONS', de: 'VORSCHLÄGE' },
  techSpellFix: { en: 'definitely', de: 'Rechtschreibprüfung' },
  techSpellIgnoreNote: { en: 'IGNORE — THIS SESSION ONLY', de: 'IGNORIEREN – NUR DIESE SITZUNG' },
  techSpellChip: { en: 'NO CLOUD', de: 'KEINE CLOUD' },
  techSpellChipNote: { en: 'REPLACES THE MACOS CHECKER', de: 'ERSETZT DIE MACOS-PRÜFUNG' },
  techSpellCap: {
    en: 'A real Hunspell runs as WebAssembly inside the app; German and English dictionaries ship in the box. No word ever leaves your machine — the built-in macOS checker is deliberately switched off.',
    de: 'Ein echtes Hunspell läuft als WebAssembly direkt in der App, deutsche und englische Wörterbücher sind gleich mit dabei. Kein Wort verlässt deinen Rechner – die Rechtschreibprüfung von macOS ist bewusst abgeschaltet.'
  },

  // 08 · Regeln
  techRulesTitle: {
    en: 'Rules — drafted once, applied forever',
    de: 'Regeln – einmal entworfen, immer angewendet'
  },
  techRulesQuote1: { en: '“Archive Hetzner invoices,', de: '„Hetzner-Rechnungen archivieren,' },
  techRulesQuote2: { en: 'make a task.”', de: 'Aufgabe anlegen.“' },
  techRulesDraft: { en: 'DRAFTS THE RULE', de: 'ENTWIRFT DIE REGEL' },
  techRulesJson: { en: 'RULE JSON', de: 'REGEL-JSON' },
  techRulesJsonIf: {
    en: 'IF: SENDER · SUBJECT · CATEGORY',
    de: 'WENN: ABSENDER · BETREFF · KATEGORIE'
  },
  techRulesJsonThen: {
    en: 'THEN: ARCHIVE · TASK · FLAG',
    de: 'DANN: ARCHIVIEREN · AUFGABE · MARKIEREN'
  },
  techRulesLaneA: { en: 'ONCE — WHEN YOU DESCRIBE IT', de: 'EINMAL – WENN DU SIE BESCHREIBST' },
  techRulesLaneB: {
    en: 'EVERY EMAIL — DETERMINISTIC · 0 AI CALLS',
    de: 'BEI JEDER E-MAIL – DETERMINISTISCH · 0 KI-AUFRUFE'
  },
  techRulesMatch: { en: 'DOES IT MATCH?', de: 'TRIFFT DIE REGEL ZU?' },
  techRulesMatchNote: { en: 'PLAIN COMPARISONS', de: 'REINE VERGLEICHE' },
  techRulesAct1: { en: 'ARCHIVE', de: 'ARCHIVIEREN' },
  techRulesAct2: { en: 'TASK', de: 'AUFGABE' },
  techRulesAct3: { en: 'CATEGORY', de: 'KATEGORIE' },
  techRulesCap: {
    en: 'The model only drafts the rule JSON from your description — one single time. Applying it happens deterministically on every email, without any further AI calls.',
    de: 'Das Modell entwirft das Regel-JSON nur einmal, aus deiner Beschreibung. Angewendet wird die Regel danach bei jeder E-Mail deterministisch – ganz ohne weitere KI-Aufrufe.'
  },

  // 09 · Follow-up-Radar
  techRadarTitle: { en: 'The follow-up radar', de: 'Das Nachfass-Radar' },
  techRadarSent1: { en: 'YOUR SENT', de: 'DEINE GESENDETE' },
  techRadarSent2: { en: 'EMAIL', de: 'E-MAIL' },
  techRadarDays: { en: '3 DAYS OF SILENCE', de: '3 TAGE OHNE ANTWORT' },
  techRadarDaysNote1: { en: 'THRESHOLD ADJUSTABLE', de: 'SCHWELLE EINSTELLBAR' },
  techRadarDaysNote2: { en: 'WINDOW 3–21 DAYS', de: 'SPANNE 3–21 TAGE' },
  techRadarCheck: { en: 'EXPECTS A REPLY?', de: 'ANTWORT ERWARTET?' },
  techRadarCheckNote: { en: 'THE CHEAP SCAN MODEL', de: 'DAS GÜNSTIGE SCAN-MODELL' },
  techRadarList: { en: 'SHOWS UP IN “WAITING”', de: 'ERSCHEINT UNTER „AUSSTEHEND“' },
  techRadarOpen: { en: 'WHEN YOU OPEN IT:', de: 'WENN DU ES ÖFFNEST:' },
  techRadarNudge: { en: 'NUDGE DRAFT', de: 'STUPS-ENTWURF' },
  techRadarVoice: { en: 'IN YOUR VOICE', de: 'IN DEINEM STIL' },
  techRadarVoiceNote: { en: 'PROFILE + DU/SIE', de: 'PROFIL + DU/SIE' },
  techRadarSend: { en: 'YOU SEND IT', de: 'DU SENDEST' },
  techRadarCap: {
    en: 'The radar finds your sent emails that stayed unanswered, counts the days, and asks a cheap model whether a reply is even expected. The nudge is only a draft in your voice — sending it stays your move.',
    de: 'Das Radar findet deine gesendeten E-Mails, die unbeantwortet geblieben sind, zählt die Tage und fragt ein günstiges Modell, ob überhaupt eine Antwort erwartet wird. Der Stups ist nur ein Entwurf in deinem Stil – abgeschickt wird er von dir.'
  },

  // 10 · Datenhaltung
  techDataTitle: { en: 'Where your data lives', de: 'Wo deine Daten liegen' },
  techDataMac: { en: 'YOUR MAC', de: 'DEIN MAC' },
  techDataDb: { en: 'NOCTUA.SQLITE', de: 'NOCTUA.SQLITE' },
  techDataDbRow1: { en: 'EMAILS · TASKS · CHATS', de: 'E-MAILS · AUFGABEN · GESPRÄCHE' },
  techDataDbRow2: { en: 'SEARCH INDEX · RULES', de: 'SUCHINDEX · REGELN' },
  techDataVault: { en: 'VAULT', de: 'TRESOR' },
  techDataVaultRow1: { en: 'SAFESTORAGE · KEYCHAIN', de: 'SAFESTORAGE · SCHLÜSSELBUND' },
  techDataVaultRow2: {
    en: 'PASSWORDS · TOKENS · API KEY',
    de: 'PASSWÖRTER · TOKEN · API-SCHLÜSSEL'
  },
  techDataOnboard: { en: 'INCLUDED:', de: 'MITGELIEFERT:' },
  techDataChip1: { en: 'E5 EMBEDDINGS', de: 'E5-EMBEDDINGS' },
  techDataChip2: { en: 'HUNSPELL DE+EN', de: 'HUNSPELL DE+EN' },
  techDataChip3: { en: 'SQLITE-VEC', de: 'SQLITE-VEC' },
  techDataNet: { en: 'NETWORK', de: 'NETZWERK' },
  techDataNetNote: { en: 'LIVE LIST BELOW', de: 'LIVE-LISTE UNTEN' },
  techDataPixels: { en: 'TRACKING PIXELS', de: 'TRACKING-PIXEL' },
  techDataBlocked: { en: 'BLOCKED BY DEFAULT', de: 'STANDARDMÄSSIG GEBLOCKT' },
  techDataCap: {
    en: 'Everything lives in one local SQLite file; credentials sit safeStorage-encrypted in a Keychain-backed vault. What actually talks to the outside is listed live below — it depends on your accounts, AI profiles and settings.',
    de: 'Alles liegt in einer lokalen SQLite-Datei. Zugangsdaten sind mit safeStorage verschlüsselt und liegen in einem Tresor, der auf dem Schlüsselbund beruht. Was tatsächlich nach außen kommuniziert, steht live in der Liste darunter – es hängt von deinen Konten, KI-Profilen und Einstellungen ab.'
  },
  techNetTitle: { en: 'Network connections', de: 'Netzwerkverbindungen' },
  techNetCap: {
    en: 'Computed from your accounts, AI profiles, update source and the Local only switch. Tracking pixels and remote images stay blocked unless you allow them.',
    de: 'Berechnet aus deinen Konten, KI-Profilen, der Update-Quelle und dem Schalter „Nur lokal“. Tracking-Pixel und externe Bilder bleiben blockiert, solange du sie nicht erlaubst.'
  },
  techNetLocalOnlyOn: { en: 'LOCAL ONLY: ON', de: 'NUR LOKAL: AN' },
  techNetLocalOnlyOff: { en: 'LOCAL ONLY: OFF', de: 'NUR LOKAL: AUS' },
  techNetKindMail: { en: 'EMAIL SERVER', de: 'E-MAIL-SERVER' },
  techNetKindCalendar: { en: 'CALENDAR SERVER', de: 'KALENDERSERVER' },
  techNetKindOauth: { en: 'SIGN-IN (OAUTH)', de: 'ANMELDUNG (OAUTH)' },
  techNetKindAi: { en: 'AI PROFILE', de: 'KI-PROFIL' },
  techNetKindUpdates: { en: 'UPDATE CHECK', de: 'UPDATE-PRÜFUNG' },
  techNetKindEmbeddings: { en: 'SEARCH MODEL', de: 'SUCHMODELL' },
  techNetActive: { en: 'ACTIVE', de: 'AKTIV' },
  techNetBlocked: { en: 'BLOCKED (LOCAL ONLY)', de: 'GESPERRT (NUR LOKAL)' },
  techNetManual: { en: 'ONLY ON REQUEST', de: 'NUR AUF ANFRAGE' },
  techNetOnDemand: { en: 'DOWNLOAD ON DEMAND', de: 'DOWNLOAD BEI BEDARF' },
  techNetCached: { en: 'CACHED · NO NETWORK', de: 'IM CACHE · KEIN NETZ' },
  techNetOff: { en: 'OFF', de: 'AUS' },
  techNetLocal: { en: 'LOCAL', de: 'LOKAL' },
  techNetExternal: { en: 'EXTERNAL', de: 'EXTERN' },
  techNetTaskTriage: { en: 'triage', de: 'Vorsortierung' },
  techNetTaskDraft: { en: 'drafts', de: 'Entwürfe' },
  techNetTaskStt: { en: 'dictation', de: 'Diktat' }
} as const

export type StringKey = keyof typeof table
export const STRINGS: Record<StringKey, { en: string; de: string }> = table
