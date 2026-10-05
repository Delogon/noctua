# Company Edition: Org-Konfiguration

Aus derselben Codebasis entsteht sowohl der Upstream-Build als auch eine
Firmenvariante — ohne Fork. Gesteuert wird das durch **eine optionale
JSON-Datei**, die zur Build-Zeit in den Main-Bundle eingebettet wird. Ohne
Datei verhält sich die App byte-für-byte wie der Upstream.

## Firmen-Build in vier Schritten

1. Vorlage kopieren und anpassen:
   `cp build/org-config.example.json build/org-config.json`
   (`build/org-config.json` ist gitignored; alternativ beliebiger Pfad via
   `NOCTUA_ORG_CONFIG=/pfad/zur/org-config.json`.)
2. Bauen: `pnpm build:mac` (oder `build:win` / `build:linux` / `build:unpack`).
   `electron-vite build` validiert die Datei gegen das zod-Schema
   (`src/shared/org-config.ts`) und **bricht bei Fehlern ab** (unbekannte Felder
   und Tippfehler eingeschlossen). `electron-builder.config.mjs` liest
   `productName`, `appId` und `executableName` aus derselben Datei.
3. Signieren und notarisieren über Umgebungsvariablen (`CSC_NAME` /
   `CSC_LINK`, `APPLE_*`) — siehe README, Abschnitt „Signing & notarization".
   Für die Firmen-`appId` braucht es ein passendes Provisioning/Developer-ID-
   Zertifikat des Unternehmens.
4. Update-Quelle bereitstellen (siehe `updates`).

Die Konfiguration steckt **im** Bundle und wird zur Laufzeit nie von der
Platte gelesen: Nutzer können sie nicht per Datei umbiegen. Wer sie ändern
will, braucht einen neuen Build.

Eine Company Edition bekommt einen eigenen Datenordner und Safe-Storage-
Schlüssel (abgeleitet aus `executableName`, sonst `productName`, sonst
`appId`; Upstream: `noctua-prod`). Beide Editionen lassen sich daher
nebeneinander installieren, ohne dieselbe Datenbank zu teilen.

## Felder

Alle Felder sind optional. Unbekannte Felder sind ein Fehler.

| Feld                       | Typ                               | Wirkung                                                                                                                                                    |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `productName`              | string (≤ 60)                     | Anzeigename: Fenstertitel, App-Menü, Über-Dialog, Bundle-Name, TCC-Texte. Default `Noctua`.                                                                |
| `appId`                    | Reverse-DNS                       | Bundle-ID / AppUserModelId. Default `de.timsigl.noctua`.                                                                                                   |
| `executableName`           | string                            | Dateiname der ausführbaren Datei.                                                                                                                          |
| `updates`                  | siehe unten                       | Update-Quelle. Default: GitHub `Schereo/noctua`.                                                                                                           |
| `links`                    | `{ homepage?, support? }` (https) | Hilfe-Menü: „Startseite" ersetzt „Noctua auf GitHub"; `support` fügt „Support" hinzu. Die Startseite ist außerdem der Link bei deaktiviertem Update-Check. |
| `defaults`                 | siehe unten                       | Voreinstellungen, die nur gelten, solange der Nutzer nichts gewählt hat.                                                                                   |
| `aiProfiles`               | Liste                             | Von der Organisation bereitgestellte KI-Profile (managed).                                                                                                 |
| `oauth`                    | `{ google?, microsoft? }`         | Eigene OAuth-Clients statt der Thunderbird-Defaults.                                                                                                       |
| `hideOpenRouterOnboarding` | boolean                           | Onboarding-Schritt 3 zeigt die Org-Profile statt der KI-Wahl (lokaler Server / Apple / Cloud / Überspringen).                                                                                   |

### `updates`

Die App zeigt nur einen Hinweis mit Link, sie installiert **nie automatisch**.

```jsonc
{ "mode": "github", "repo": "owner/name" }                       // Releases-API (anonym)
{ "mode": "url", "url": "https://updates.example.com/latest.json" } // eigenes JSON
{ "mode": "off" }                                                 // nie prüfen, auch nicht manuell
```

Format der Datei im Modus `url`:

```json
{ "version": "1.4.0", "url": "https://updates.example.com/Acme-1.4.0.dmg", "notes": "optional" }
```

`url` muss `https://` sein. Local only (Einstellungen → Intelligenz) bleibt
unabhängig vom Modus wirksam: automatische Prüfungen entfallen, der Knopf
„Jetzt prüfen" funktioniert weiter — außer bei `off`.

### `defaults`

Werden beim Start gesetzt, **nur wenn der Schlüssel noch nicht existiert**;
Nutzerwahlen werden nie überschrieben.

| Feld                      | Werte                                              | Setting                                                   |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `localOnly`               | boolean                                            | `privacy.localOnly`                                       |
| `remoteImagesDefault`     | `block` (Upstream) / `allow`                       | `mail.remoteImagesDefault` (`0`/`1`)                      |
| `language`                | `de` / `en` / `auto` (Systemsprache: de, sonst en) | `ui.language`                                             |
| `aiEnabledForNewAccounts` | boolean                                            | `ai_enabled` bei neuen Konten (gilt zum Anlege-Zeitpunkt) |

### `aiProfiles`

```json
{
  "id": "acme-llm",
  "name": "Acme LLM",
  "baseUrl": "https://llm.example.com/v1",
  "apiStyle": "chat",
  "isLocal": false,
  "tasks": { "triage": "small-model", "draft": "large-model", "stt": "whisper-1" }
}
```

- `id`: `a-z0-9_-`, max. 40 Zeichen, eindeutig; `openrouter` und `apple` sind reserviert.
- Beim Start werden fehlende Profile angelegt (Datenbank-Spalte
  `ai_profiles.managed = 1`, Migration 027). Bestehende managed-Profile werden
  mit der Konfiguration synchron gehalten (neue URL im nächsten Build wirkt).
  Ein eigenes Nutzerprofil mit gleicher ID bleibt unberührt.
- **In der Oberfläche** sind Name, URL, API-Stil und lokal-Flag gesperrt, das
  Profil trägt das Etikett ORGANISATION und lässt sich nicht löschen. Nur der
  API-Key bleibt editierbar (er liegt im Vault, nie in der Konfiguration).
- `tasks` (Aufgabe → Modell) wird **nur beim allerersten Anlegen** des Profils
  zugewiesen. Spätere Änderungen des Nutzers bleiben bestehen.
- `isLocal` steuert „Local only": externe Profile werden dort gesperrt.

### `oauth`

```json
{
  "google": { "clientId": "…apps.googleusercontent.com", "clientSecret": "optional" },
  "microsoft": { "clientId": "00000000-0000-0000-0000-000000000000" }
}
```

Vorrang: explizites Main-Setting (`google.clientId`, `ms.clientId`, wie bisher
nur im Main erreichbar) > Org-Konfiguration > Thunderbird-Default. Ein Org-
Google-Client erhält **nie** das Thunderbird-Secret; ohne `clientSecret` wird
keines gesendet (öffentlicher Installed-App-Client mit PKCE). Hinweis: Das
`clientSecret` steckt im Bundle und ist damit nicht vertraulich — wie bei jeder
Desktop-App.

Microsoft nutzt weiterhin die Authority `common`; Tenant-spezifische
Authorities sind nicht Teil dieser Konfiguration.

## Transparenz: Netzwerkverbindungen

Technik-Seite → Abschnitt 11 listet live, womit die App spricht: Mailserver je
Konto, genutzte OAuth-Anbieter, KI-Profile (Name, Host, lokal/extern, Aufgaben),
Update-Quelle (oder „aus"), Modell-Download der Suche (bei Bedarf/im Cache) und
ob Local only aktiv ist. Die Liste wird aus Konten, Profilen und Konfiguration
berechnet.

## Bewusst nicht enthalten

- **MDM / Managed Preferences:** nicht angebunden. `getOrgConfig()` in
  `src/main/org-config.ts` ist die einzige Lesestelle; eine zusätzliche Quelle
  (z. B. `NSUserDefaults` / Configuration Profile) lässt sich dort mit der
  eingebetteten Konfiguration zusammenführen, ohne Aufrufer zu ändern.
- **Durchgängiges Rebranding der Oberfläche:** `productName` wirkt in
  Fenstertitel, Menü, Über-Dialog und Bundle. Der „Noctua"-Schriftzug im
  Masthead und Fließtexte der Oberfläche (i18n) bleiben unverändert; Icons
  (`build/icon.*`) tauscht man im Build-Verzeichnis aus.
