# Decision models (Ollama System One)

Decision models answer **typed questions with probabilities** instead of generating text:
"Which category?", "Does this mail expect a reply?", "How likely is this phishing?". They are
small, fast and cheap, and they never write prose. Noctua uses them for the work that is really
classification and keeps the chat/writing model for the places where text is needed.

Examples: `clef-flash`, `clef`, `nimble`, `tev1` (Ollama capability `decision`).

## Setup

1. Ollama **0.35.0 or newer** (Clef models and image input need 0.35.1).
2. `ollama pull clef-flash`
3. Settings → AI → **Decisions**: pick your Ollama profile and the model, press **Test**.
   Onboarding (local server) preselects a decision model if the detected Ollama has one and
   otherwise shows the hint `ollama pull clef-flash`.

The feature is optional and **off by default**. Without a decision model Noctua behaves exactly as
before. Org config: `aiProfiles[].tasks.decision` (see [ORG-CONFIG.md](ORG-CONFIG.md)).

## API in short

`POST {ollama}/v1/systemone` with `{model, state, questions}`. Question types:

| Type     | Criteria                    | Answer                                            |
| -------- | --------------------------- | ------------------------------------------------- |
| `choice` | 2–26 named options          | best option + probabilities + confidence          |
| `noul`   | descriptions for false/true | P(true) from 0 to 1                               |
| `score`  | 2–26 ordered descriptions   | probability-weighted average of the 0-based level |

Limits: at most 64 questions per call, request body ≤ 64 KiB (Noctua truncates the mail text to
stay under ~60 KiB; the server never truncates), the whole input must fit the loaded context window.
No streaming. Decision models report the capability `decision` **only**: they must not be used for
chat or generation, so every chat/draft model picker hides decision-only models
(`/api/tags` `capabilities`, falling back to `/api/show`).

Client: `src/main/ai/providers/systemone.ts` (zod request/response schemas, size guard, timeout,
error mapping: 404 "ollama pull …", 400 "not a decision model" / context exceeded, 413, 5xx
transient). Usage is logged with cost 0.

## Which features use it

| Feature           | Question(s)                                                                                                                                                                       | What it saves                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hybrid triage     | `category` (choice), `priority` (score 5 levels), `needs_reply`, `addressed_to_me`, `has_request`, `proposes_meeting` (noul), `phishing` (score 3 levels) — **one call per mail** | the generative triage call; the text model runs only when a gate opens (below) |
| Follow-up radar   | `expects_reply` (noul) for sent mails                                                                                                                                             | the generative "does this expect a reply" call                                 |
| Event suggestions | `proposes_meeting` from the triage decision (stored)                                                                                                                              | the generative event extraction for every mail that proposes no meeting        |
| Phishing warning  | `phishing` + local signals (below)                                                                                                                                                | nothing to generate; adds a warning banner in the mail view                    |
| Rules             | one `noul` question per rule with an **AI condition**, batched into one call per mail                                                                                             | n/a (new capability)                                                           |

### Hybrid triage: decide first, write only if needed

1. One System One call yields category, priority, `needs_reply`, `addressed_to_me`, `has_request`,
   `proposes_meeting` and the phishing score.
2. The text model (existing triage profile/model) runs **only** if a gate opens:
   - **task titles**: `has_request ≥ 0.5` and `addressed_to_me ≥ 0.5`, and the mail is not
     self-authored / a forward without a request (the existing rules still apply);
   - **one-line summary**: only for `priority ≥ 3` or `needs_reply ≥ 0.6`.
     When both gates are open it is one combined call.
3. Every other mail gets an **extractive summary** (first meaningful sentence, cleaned, ≤ 140
   characters, no AI).
4. `ai_annotations` keeps its schema, so the UI is unchanged: `confidence` is the category
   decision's confidence, `model` is e.g. `clef-flash` or `clef-flash+qwen3:30b` (when the text model
   also ran). Rules on top still apply: known-sender priority bump, `List-Unsubscribe` penalty,
   task suppression for own mail and forwards.
5. `PROMPT_VERSION` is unchanged by this feature: switching between classic and hybrid mode does
   **not** re-triage the 30-day window (the queue only picks up mails without an annotation of the
   current version). Mails triaged earlier simply have no `ai_decisions` row.

If the decision model is misconfigured (404 model missing, "not a decision model", context too
small) Noctua falls back to the classic triage for that mail. Transient errors (5xx, network)
follow the AI queue's retry/circuit-breaker rules. If no text model is usable (e.g. Local only with
an external triage profile) the decision part still runs; summaries are extractive and no task
titles are generated.

### Thresholds

All in `src/shared/decision-thresholds.ts`:

| Constant                           | Value    | Meaning                                   |
| ---------------------------------- | -------- | ----------------------------------------- |
| `HAS_REQUEST_THRESHOLD`            | 0.5      | write task titles                         |
| `NEEDS_REPLY_THRESHOLD`            | 0.6      | needs reply (also opens the summary gate) |
| `ADDRESSED_TO_ME_THRESHOLD`        | 0.5      | addressed to the account owner            |
| `PROPOSES_MEETING_THRESHOLD`       | 0.5      | event job runs the generative extraction  |
| `FOLLOWUP_EXPECTS_REPLY_THRESHOLD` | 0.5      | sent mail expects a reply                 |
| `RULE_AI_CONDITION_THRESHOLD`      | 0.6      | rule AI condition holds                   |
| `PHISHING_SCORE_HIGH`              | 1.4 of 2 | warning banner (≈ 70 %)                   |
| `SUMMARY_MIN_PRIORITY`             | 3        | text model writes the summary             |

Priority: the `priority` score (0..4) is rounded and shifted to 1..5.

### Phishing warning

The phishing question is asked in the same triage call. Cheap local signals are added to the
`state` text so the model judges with context: a domain in the display name that differs from the
real sender domain, a `Reply-To` on another domain, links whose visible text names a different
host than the target (`src/shared/link-check.ts`), links to raw IP addresses and punycode hosts.
The raw score and the signal codes are stored in `ai_decisions` (migration 033). At score ≥ 1.4 the
mail view shows a banner: "Diese E-Mail sieht nach Phishing aus – klicke keine Links, gib keine
Zugangsdaten ein." with the warning signs that were found. Noctua **never moves, blocks or deletes**
mail because of it. It only runs with a decision model.

### Rules with an AI condition

A rule may carry `aiCondition` (natural-language yes/no question, ≤ 200 characters, e.g. "Ist das
eine Rechnung?"). After triage Noctua asks the decision model all AI conditions of all enabled rules
whose other criteria already match, in **one call** (one `noul` question per rule, at most 64). A
rule fires if its probability is ≥ 0.6 and all other conditions match. Without a decision model
(or when the call fails) rules with an AI condition are skipped; the rules list shows a hint. The
condition text is authored by the user (trusted); the mail content is passed as untrusted data
(SEC-15).

## Privacy

Decision models run **only on your own Ollama server**. A decision profile follows the same
"Local only" gating as other tasks (an external profile is refused while Local only is on).
OpenRouter cannot be used for decisions. Mail content is sent to the profile's server only; with a
loopback Ollama nothing leaves the device. Capability probing (`/api/tags`, `/api/show`) only
targets profiles marked local, except for the explicit decision-model picker.

## Limitations

- Needs Ollama ≥ 0.35 and a model with weights the runner supports; cloud models are rejected.
- Not used with Apple On-Device triage (the Foundation Models path stays as it is).
- The decision call sees at most ~6000 characters of the mail (like the classic prompt); long
  mails and small context windows (`num_ctx`) can still trigger "prompt exceeds context" (then the
  classic triage takes over).
- Priority and categories are only as good as the model; thresholds are conservative defaults,
  not tuned on real data yet.
- Phishing is a hint, not a filter; false positives and negatives are expected.
- Mails triaged before decision mode was enabled have no stored decision: the event job keeps
  running the generative extraction for them.
- Image input (Clef) is not used yet.
