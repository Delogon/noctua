# On-Device-Diktat (macOS-Spracherkennung)

## Funktionsweise

Der Renderer nimmt weiterhin auf und liefert WAV. Statt per OpenRouter zu
transkribieren, kann der Main-Prozess die Aufnahme an den Swift-Helper
`noctua-fm` (native/fm-helper) geben:

1. `transcribeWithApple(wav, 'wav', locale)` (src/main/ai/apple-speech.ts)
   schreibt die WAV nach `app.getPath('temp')` (`noctua-stt-<zufall>.wav`,
   Modus 0600) und löscht sie im `finally` — auch bei Fehler oder Timeout.
2. Der Helper läuft als Einmal-Prozess: `noctua-fm transcribe <wav> <locale>`.
   Kein serve-Modus: Diktate sind selten und lang, ein Prozess je Diktat lässt
   sich per Timeout (180 s, SIGKILL) hart beenden, und die Sprache soll auch
   ohne aktives Apple Intelligence laufen (der FM-serve-Modus bricht dort ab).
   Eine Binärdatei (`noctua-fm`) bleibt bewusst erhalten: ein Signier-/Bundle-
   Artefakt, ein Build-Skript.
3. Engine: `SpeechAnalyzer` + `SpeechTranscriber` (macOS 26, on-device). Ist die
   Locale dort nicht unterstützt, Fallback auf `SFSpeechRecognizer` mit
   `requiresOnDeviceRecognition = true` und nur wenn `supportsOnDeviceRecognition`.
   Server-Erkennung wird nie verwendet.
4. Antwort: eine JSON-Zeile `{"ok":true,"text":…}` oder
   `{"ok":false,"error":"unavailable|assets-missing|permission-denied|failed"}`.
   TS wirft `AppleSpeechError` mit `code` (zusätzlich `timeout`, `helper-missing`).

Weitere Modi: `stt-check <locale>` (Verfügbarkeit, ohne Download/Dialog) und
`stt-install <locale>` (Sprachpaket laden, siehe unten).

## Voraussetzungen

- macOS 26 (Tahoe), Apple Silicon empfohlen. Der Helper wird nur mit
  macOS-26-SDK gebaut (`pnpm build:fm`); ohne ihn meldet
  `isAppleSpeechAvailable()` `helper-missing`.
- Sprachpaket der Locale. `SpeechTranscriber` nutzt vom System verwaltete Assets
  (`AssetInventory`). `transcribe` lädt nie selbst nach und meldet
  `assets-missing`; die UI soll dann `ensureAppleSpeechAssets(locale)` anbieten
  („Sprachpaket laden"). Das ist der einzige Pfad mit Netzzugriff und wird vom
  System (nicht von Noctua) abgewickelt. Danach läuft alles offline.
- Locale aus `ui.language`: `appleSpeechLocale('de' | 'en' | 'auto')` →
  `de-DE` / `en-US`.

## Berechtigungen

- `NSSpeechRecognitionUsageDescription` steht in `electron-builder.yml`
  (`mac.extendInfo`) und zusätzlich als eingebettetes Info.plist im Helper
  (`native/fm-helper/Info.plist`, per `-sectcreate __TEXT __info_plist`).
  Bei Kindprozessen ordnet macOS die Anfrage dem verantwortlichen Prozess (der
  App) zu; das Embedding ist Absicherung für den Helper als Mach-O.
- Der System-Dialog „Spracherkennung" erscheint beim ersten SFSpeech-Fallback
  (`ensureSpeechAuthorization`). Ob `SpeechAnalyzer` überhaupt eine TCC-Freigabe
  verlangt, ist auf einem Mac zu prüfen. Verweigerung → `permission-denied`
  (Systemeinstellungen > Datenschutz > Spracherkennung).
- `NSMicrophoneUsageDescription` ergänzt, da der Renderer per getUserMedia
  aufnimmt (war nicht gesetzt).
- Entitlements: unverändert. Keine Sandbox, kein Netzwerk-Entitlement, keine
  Audio-Input-Entitlement für den Helper (liest nur eine Datei).

## Verdrahtung in die STT-Auswahl (Orchestrator)

Pseudo-Profil `apple` neben den Provider-Profilen:

```ts
// Auswahl des STT-Tasks
if (profile === 'apple') {
  const locale = appleSpeechLocale(settings.get('ui.language'))
  const state = await isAppleSpeechAvailable(locale)
  if (!state.available) {
    if (state.reason === 'assets-missing') {
      // UI: „Sprachpaket laden" → await ensureAppleSpeechAssets(locale)
    }
    throw new Error(`Apple-Diktat nicht verfügbar: ${state.reason}`) // oder Fallback auf Cloud-Profil
  }
  return transcribeWithApple(wavBuffer, 'wav', locale)
}
```

Hinweise: Der Apple-Pfad braucht WAV (MP3-Hörer-Audio vorher nach WAV
wandeln oder beim Cloud-Pfad bleiben). `isAppleSpeechAvailable` startet einen
Prozess — Ergebnis cachen (wie `appleFmStatus`, 60 s). Der Apple-Pfad
verursacht keine Kosten und braucht keinen API-Key.

## Auf einem Mac zu prüfen

- `pnpm build:fm` kompiliert (speech.swift gegen macOS-26-SDK; API-Namen
  `AssetInventory.status`, `analyzeSequence`, `finalizeAndFinish(through:)`).
- `noctua-fm stt-check de-DE`, `stt-install de-DE`, `transcribe x.wav de-DE`.
- TCC-Dialog/Usage-Text im paketierten Build, Verhalten bei Verweigerung.
- Signierter Helper in `Contents/Resources` läuft (Hardened Runtime).
- 2-Minuten-Diktat: Dauer und Qualität.
