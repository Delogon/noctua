import AVFoundation
import Foundation
import Speech

// Speech recognition for Noctua — fully on-device, never server recognition.
// Usage (one-shot processes, no serve mode: dictations are rare and long,
// a child process per dictation can be hard-killed by timeout and needs
// no state; also, speech is independent of Apple Intelligence):
//   noctua-fm stt-check <locale>          → availability, downloads nothing
//   noctua-fm stt-install <locale>        → downloads the language pack (system download)
//   noctua-fm transcribe <wav> <locale>   → transcript of a local file
// The response is always exactly one JSON line:
//   {"ok":true,"text":"…","engine":"speech-analyzer"|"sf-speech"}
//   {"ok":true,"state":"available"|"assets-missing"|"permission-denied"|"unavailable"}
//   {"ok":false,"error":"unavailable|assets-missing|permission-denied|failed","detail":"…"}

struct SpeechFailure: Error {
  let code: String
  let detail: String
  init(_ code: String, _ detail: String = "") {
    self.code = code
    self.detail = detail
  }
}

/// Local file → transcript. Picks SpeechAnalyzer (macOS 26), otherwise SFSpeechRecognizer.
func speechTranscribe(path: String, localeId: String) async throws -> [String: Any] {
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.isReadableFile(atPath: path) else {
    throw SpeechFailure("failed", "Audiodatei nicht lesbar")
  }
  let locale = Locale(identifier: localeId)

  if #available(macOS 26.0, *),
    let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
  {
    let transcriber = makeTranscriber(supported)
    switch await AssetInventory.status(forModules: [transcriber]) {
    case .installed:
      let text = try await analyzerTranscribe(url, transcriber)
      return ["ok": true, "text": text, "engine": "speech-analyzer"]
    case .supported, .downloading:
      // Download only explicitly via stt-install — transcribe stays offline.
      throw SpeechFailure("assets-missing", "Sprachpaket für \(supported.identifier) fehlt")
    case .unsupported:
      break  // → Fallback
    @unknown default:
      break
    }
  }
  let text = try await sfTranscribe(url, locale)
  return ["ok": true, "text": text, "engine": "sf-speech"]
}

@available(macOS 26.0, *)
func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
  // Only final results, no timestamps/attributes needed.
  SpeechTranscriber(
    locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
}

@available(macOS 26.0, *)
func analyzerTranscribe(_ url: URL, _ transcriber: SpeechTranscriber) async throws -> String {
  let file = try AVAudioFile(forReading: url)
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  // Collect results in parallel while the file is analyzed.
  let collector = Task { () throws -> String in
    var text = ""
    for try await result in transcriber.results {
      text += String(result.text.characters)
    }
    return text
  }
  do {
    if let last = try await analyzer.analyzeSequence(from: file) {
      try await analyzer.finalizeAndFinish(through: last)
    } else {
      await analyzer.cancelAndFinishNow()
    }
    return try await collector.value.trimmingCharacters(in: .whitespacesAndNewlines)
  } catch {
    collector.cancel()
    throw error
  }
}

/// Fallback: classic recognition, but strictly on-device.
func sfTranscribe(_ url: URL, _ locale: Locale) async throws -> String {
  guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable,
    recognizer.supportsOnDeviceRecognition
  else {
    throw SpeechFailure("unavailable", "Keine On-Device-Erkennung für \(locale.identifier)")
  }
  try await ensureSpeechAuthorization()

  let request = SFSpeechURLRecognitionRequest(url: url)
  request.requiresOnDeviceRecognition = true
  request.shouldReportPartialResults = false

  return try await withCheckedThrowingContinuation { continuation in
    var finished = false  // Guard against double resume
    recognizer.recognitionTask(with: request) { result, error in
      if finished { return }
      if let result = result, result.isFinal {
        finished = true
        continuation.resume(
          returning: result.bestTranscription.formattedString
            .trimmingCharacters(in: .whitespacesAndNewlines))
      } else if let error = error {
        finished = true
        continuation.resume(throwing: SpeechFailure("failed", error.localizedDescription))
      }
    }
  }
}

/// TCC prompt: the first time, the system dialog appears (text from the app's
/// Info.plist or the embedded helper plist).
func ensureSpeechAuthorization() async throws {
  var status = SFSpeechRecognizer.authorizationStatus()
  if status == .notDetermined {
    status = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
  }
  guard status == .authorized else {
    throw SpeechFailure(
      "permission-denied", "Spracherkennung nicht erlaubt (Status \(status.rawValue))")
  }
}

/// Availability without side effects (no download, no dialog).
func speechCheck(localeId: String) async -> [String: Any] {
  let locale = Locale(identifier: localeId)
  if #available(macOS 26.0, *), SpeechTranscriber.isAvailable,
    let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
  {
    let transcriber = makeTranscriber(supported)
    switch await AssetInventory.status(forModules: [transcriber]) {
    case .installed:
      return ["ok": true, "state": "available", "engine": "speech-analyzer"]
    case .supported, .downloading:
      return ["ok": true, "state": "assets-missing", "engine": "speech-analyzer"]
    default:
      break
    }
  }
  if let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable,
    recognizer.supportsOnDeviceRecognition
  {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .denied || status == .restricted {
      return ["ok": true, "state": "permission-denied", "engine": "sf-speech"]
    }
    return ["ok": true, "state": "available", "engine": "sf-speech"]
  }
  return ["ok": true, "state": "unavailable"]
}

/// Downloads the language pack (the only path with network access — managed by the
/// system, only at the user's explicit request).
func speechInstall(localeId: String) async throws -> [String: Any] {
  guard #available(macOS 26.0, *),
    let supported = await SpeechTranscriber.supportedLocale(
      equivalentTo: Locale(identifier: localeId))
  else {
    throw SpeechFailure("unavailable", "Sprache \(localeId) wird nicht unterstützt")
  }
  let transcriber = makeTranscriber(supported)
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    try await request.downloadAndInstall()
  }
  return ["ok": true, "state": "available", "engine": "speech-analyzer"]
}
