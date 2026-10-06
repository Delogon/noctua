# Glossar und Schreibregeln (DE/EN)

Verbindlich für alle UI-Texte (`src/renderer/src/i18n/strings.ts`, lokale Tabellen
wie `InvitationCard.tsx`, Fehlermeldungen aus dem Main-Prozess, Menü, Info.plist).
`test/renderer/i18n-copy.test.ts` prüft einen Teil davon automatisch.

## Ton und Anrede

- Deutsch: durchgehend **du / dein** (klein), nie „Sie“ für die Nutzerin oder den Nutzer.
  Ruhig, knapp, leicht verspielt; die Eule darf vorkommen, ohne dass Witze erzwungen werden.
- Englisch: US-Englisch (color, organization, canceled), klar und knapp.
- Typografie DE: „…“ als Anführungszeichen, Gedankenstrich als „ – “ (Halbgeviertstrich mit
  Leerzeichen), Auslassung als „…“, „z. B.“ mit geschütztem Leerzeichen-Stil wie im Bestand.
  EN: Geviertstrich „—“ wie im Bestand.
- GROSSBUCHSTABEN-Labels bleiben groß, wo das Englische groß ist. Deutsche Labels in engen
  Elementen (Tabs, Badges, Buttons) sollen nicht mehr als etwa 40 % länger sein als das
  englische.

## Entscheidungen

| Thema                       | Entscheidung                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-Mail vs. Mail**         | DE: „E-Mail“ / „E-Mails“ in Sätzen und Labels (auch „NEUE E-MAIL“). „Mail“ nur in festen Komposita wie „Mailserver“. Nie „Post“ als Wort für E-Mail („Posteingang“ bleibt). EN: „email“ (nicht „mail“, nicht „e-mail“). |
| **Local only**              | Funktionsname, in DE **„Nur lokal“** (in Sätzen in Anführungszeichen, im Badge `NUR LOKAL`). In EN bleibt **Local only**.                                                                                               |
| **KI**                      | DE: „KI“ (Settings-Bereich „KI“, „KI-Anbieter“, „KI-Profil“). EN: „AI“ (Settings → AI). „Apple Intelligence“ und „OpenRouter“ bleiben Produktnamen.                                                                     |
| **Konto vs. Postfach**      | Immer **Konto** / **account**; „Postfach“ und „mailbox“ entfallen.                                                                                                                                                      |
| **Thread**                  | DE: „Unterhaltung“ (in engen Labels „E-Mail“). EN: „thread“.                                                                                                                                                            |
| **Stimme / voice**          | DE: „Stil“ bzw. „in deinem Stil“ (passt zum Bereich „Stil“). EN: „voice“ bleibt in „in your voice“.                                                                                                                     |
| **Triage / Rang**           | DE: „Vorsortierung“, „Einschätzung“, „Priorität“ (nicht „Rang“).                                                                                                                                                        |
| **Vault**                   | DE: „Tresor“.                                                                                                                                                                                                           |
| **Gist**                    | DE: „Kurzfassung“. EN: „gist“ (Produktbegriff).                                                                                                                                                                         |
| **Nudge**                   | DE: „Stups“ / „Stupser“ (Entwurf zum Nachfassen). EN: „nudge“.                                                                                                                                                          |
| **Waiting**                 | DE: „Ausstehend“ (Ansicht für unbeantwortete Mails). EN: „Waiting“.                                                                                                                                                     |
| **Filed / file away**       | Die Taste `e` archiviert: DE „archivieren“, EN „archive“.                                                                                                                                                               |
| **Remote images**           | DE: „externe Bilder“. EN: „remote images“.                                                                                                                                                                              |
| **Beschreibbarer Kalender** | DE: „Kalender mit Schreibzugriff“.                                                                                                                                                                                      |

## Wörterbuch

| Deutsch                                    | Englisch                     |
| ------------------------------------------ | ---------------------------- |
| E-Mail, E-Mails                            | email, emails                |
| Konto, Konten                              | account, accounts            |
| Posteingang                                | Inbox                        |
| Gesendet                                   | Sent                         |
| Entwürfe, Entwurf                          | Drafts, draft                |
| Archiv, archivieren                        | Archive, archive             |
| Papierkorb                                 | Trash                        |
| Spam                                       | Spam                         |
| Absender                                   | sender                       |
| Empfänger                                  | recipient                    |
| Betreff                                    | subject                      |
| Anhang, Anhänge                            | attachment(s)                |
| Antworten / Allen antworten / Weiterleiten | Reply / Reply all / Forward  |
| Aufgabe, Aufgaben                          | task, tasks                  |
| Termin                                     | event                        |
| Serientermin                               | recurring event              |
| Kalender                                   | calendar                     |
| Einladung                                  | invitation                   |
| Zusagen / Mit Vorbehalt / Absagen          | Accept / Tentative / Decline |
| Teilnehmende                               | attendees                    |
| Organisator                                | organizer                    |
| Erinnerung                                 | reminder                     |
| Kontakte, Adressbuch                       | contacts, address book       |
| Einstellungen                              | Settings                     |
| KI                                         | AI                           |
| Anbieter                                   | provider                     |
| Modell                                     | model                        |
| Nur lokal                                  | Local only                   |
| Diktat, diktieren                          | dictation, dictate           |
| Signatur                                   | signature                    |
| Stil                                       | style / voice                |
| Stups                                      | nudge                        |
| Ausstehend                                 | Waiting                      |
| Kurzfassung                                | gist                         |
| Vorsortierung                              | triage                       |
| Synchronisieren, Abgleich                  | sync                         |
| Server                                     | server                       |
| Passwort, App-Passwort                     | password, app password       |
| Schlüssel                                  | key                          |
| Tresor                                     | vault                        |
| Anmelden / Erneut anmelden                 | Sign in / Sign in again      |
| Verbinden / Trennen                        | Connect / Disconnect         |
| Eule                                       | owl                          |
