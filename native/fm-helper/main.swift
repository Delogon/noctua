import Foundation
import FoundationModels

// Noctua helper for Apple Foundation Models (macOS 26+, Apple Silicon).
// Two modes:
//   noctua-fm check  → one JSON line with the availability
//   noctua-fm serve  → line protocol on stdin/stdout:
//     Request : {"id":1,"instructions":"…","prompt":"…"}
//     Response: {"id":1,"ok":true,"result":{…}} | {"id":1,"ok":false,"error":"…"}
// Guided generation guarantees the structure; the value ranges (category
// enum, priority clamp) are validated by the TypeScript caller.

@Generable
struct FMActionItem {
  @Guide(description: "Concrete task for the recipient, short, in the language the instructions ask for")
  var title: String
  @Guide(description: "Deadline as YYYY-MM-DD, otherwise an empty string")
  var due: String
}

@Generable
struct FMGate {
  @Guide(
    description:
      "true ONLY if a human asks the account owner PERSONALLY to do something, there is a real deadline for THEM, or the sender is clearly waiting for a personal reply. false for newsletters, advertising, notifications, mass mailings, security notices"
  )
  var isPersonalRequest: Bool
  @Guide(description: "Reason in one short sentence")
  var reason: String
}

@Generable
struct FMTriage {
  @Guide(
    description:
      "Exactly one of: personal, work, newsletter, promotions, notifications, transactional, other"
  )
  var category: String
  @Guide(description: "Priority as an integer from 1 (ignorable) to 5 (urgent)")
  var priority: Int
  @Guide(description: "One factual sentence in the language the instructions ask for, at most 140 characters")
  var summary: String
  @Guide(description: "Tasks ONLY for a personal request to the account owner, otherwise empty")
  var actionItems: [FMActionItem]
  @Guide(description: "true only for real people who expect a reply")
  var needsReply: Bool
  @Guide(description: "true only if the account owner is meant personally")
  var addressedToMe: Bool
  @Guide(description: "Confidence from 0.0 to 1.0")
  var confidence: Double
}

func jsonLine(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
    let line = String(data: data, encoding: .utf8)
  else {
    FileHandle.standardOutput.write("{\"ok\":false,\"error\":\"encode\"}\n".data(using: .utf8)!)
    return
  }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func availabilityPayload() -> [String: Any] {
  switch SystemLanguageModel.default.availability {
  case .available:
    return ["ok": true, "state": "available"]
  case .unavailable(let reason):
    let code: String
    switch reason {
    case .deviceNotEligible: code = "deviceNotEligible"
    case .appleIntelligenceNotEnabled: code = "appleIntelligenceNotEnabled"
    case .modelNotReady: code = "modelNotReady"
    @unknown default: code = "unknown"
    }
    return ["ok": true, "state": "unavailable", "reason": code]
  }
}

func triagePayload(_ result: FMTriage) -> [String: Any] {
  [
    "category": result.category,
    "priority": result.priority,
    "summary": result.summary,
    "action_items": result.actionItems.map { ["title": $0.title, "due": $0.due] },
    "needs_reply": result.needsReply,
    "addressed_to_me": result.addressedToMe,
    "confidence": result.confidence
  ]
}

/// Dispatcher for the stt modes; errors are reported structured (exit 0,
/// so the caller evaluates the JSON line instead of the exit code).
func runSpeech(mode: String, args: [String]) async {
  do {
    switch mode {
    case "stt-check":
      jsonLine(await speechCheck(localeId: args.first ?? "en-US"))
    case "stt-install":
      jsonLine(try await speechInstall(localeId: args.first ?? "en-US"))
    default:  // transcribe <wav> <locale>
      guard args.count >= 2 else {
        throw SpeechFailure("failed", "Aufruf: transcribe <wav> <locale>")
      }
      jsonLine(try await speechTranscribe(path: args[0], localeId: args[1]))
    }
  } catch let failure as SpeechFailure {
    jsonLine(["ok": false, "error": failure.code, "detail": failure.detail])
  } catch {
    jsonLine(["ok": false, "error": "failed", "detail": String(describing: error)])
  }
}

@main
struct Helper {
  static func main() async {
    setvbuf(stdout, nil, _IOLBF, 0)
    let mode = CommandLine.arguments.dropFirst().first ?? "check"

    if mode == "check" {
      jsonLine(availabilityPayload())
      return
    }

    // Speech recognition (speech.swift): one-shot processes, independent of the FM model
    if ["stt-check", "stt-install", "transcribe"].contains(mode) {
      await runSpeech(mode: mode, args: Array(CommandLine.arguments.dropFirst(2)))
      return
    }

    guard mode == "serve" else {
      jsonLine(["ok": false, "error": "unbekannter Modus: \(mode)"])
      exit(2)
    }

    guard case .available = SystemLanguageModel.default.availability else {
      jsonLine(availabilityPayload())
      exit(3)
    }

    while let line = readLine(strippingNewline: true) {
      guard !line.isEmpty else { continue }
      guard
        let data = line.data(using: .utf8),
        let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let id = request["id"] as? Int,
        let instructions = request["instructions"] as? String,
        let prompt = request["prompt"] as? String
      else {
        jsonLine(["id": -1, "ok": false, "error": "ungültige Anfrage"])
        continue
      }
      let mode = request["mode"] as? String ?? "triage"

      do {
        // Fresh session per request: no context growth across mails.
        let session = LanguageModelSession(instructions: instructions)
        if mode == "gate" {
          let response = try await session.respond(to: prompt, generating: FMGate.self)
          jsonLine([
            "id": id, "ok": true,
            "result": [
              "is_personal_request": response.content.isPersonalRequest,
              "reason": response.content.reason
            ]
          ])
        } else {
          let response = try await session.respond(to: prompt, generating: FMTriage.self)
          jsonLine(["id": id, "ok": true, "result": triagePayload(response.content)])
        }
      } catch {
        jsonLine(["id": id, "ok": false, "error": String(describing: error)])
      }
    }
  }
}
