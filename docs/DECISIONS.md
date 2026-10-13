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

| Feature           | Question(s)                                                                                                                                                                                   | What it saves                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hybrid triage     | `category` (choice), `priority` (score 5 levels), `needs_reply`, `addressed_to_me`, `has_request`, `proposes_meeting` (noul), `phishing`, `spam` (score 3 levels) — **one call per question** | the generative triage call; the text model runs only when a gate opens (below) |
| Follow-up radar   | `expects_reply` (noul) for sent mails                                                                                                                                                         | the generative "does this expect a reply" call                                 |
| Event suggestions | `proposes_meeting` from the triage decision (stored)                                                                                                                                          | the generative event extraction for every mail that proposes no meeting        |
| Phishing warning  | `phishing` + local signals (below)                                                                                                                                                            | nothing to generate; adds a warning banner in the mail view                    |
| Rules             | one `noul` question per rule with an **AI condition**, one call per rule                                                                                                                      | n/a (new capability)                                                           |

### Hybrid triage: decide first, write only if needed

1. System One answers category, priority, `needs_reply`, `addressed_to_me`, `has_request`,
   `proposes_meeting`, `phishing` and `spam`. Each question is its own call (sent in parallel) with
   a short, explicit definition of what counts as "yes" and only the context it needs (see
   [One call per question](#one-call-per-question)).
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

### One call per question

Decision calls are cheap, so every question gets its own call instead of one long `state` with all
questions at once. Each question (`TRIAGE_QUESTIONS` in `src/main/ai/decision-triage.ts`) states
precisely what counts, e.g. `has_request` only for a concrete action the sender asks of the
recipient, not for newsletters' calls to action. The `state` of each call holds the mail header plus
only the blocks that question needs (`QUESTION_CONTEXT`):

| Question                         | Context besides the header                     |
| -------------------------------- | ---------------------------------------------- |
| `category`                       | sender signals, body                           |
| `priority`, `needs_reply`        | recipient, sender signals, body                |
| `addressed_to_me`, `has_request` | recipient, body                                |
| `proposes_meeting`               | body                                           |
| `phishing`                       | Reply-To, sender signals, security, short body |
| `spam`                           | sender signals, security, body                 |

The separate security check and rules with an AI condition work the same way. The setting
`ai.decisionMode = single` switches back to one combined call per mail (for comparison or slow
servers).

**Eval**: `pnpm test:decision-eval` runs the real triage against a labelled set of 32 German and
English mails (`test/local/decision-eval.dataset.ts`) in both modes and reports accuracy,
precision/recall and latency per mail to `test/local/out/`. It needs a reachable Ollama with a
decision model:

```sh
NOCTUA_OLLAMA_URL=http://127.0.0.1:11434 NOCTUA_DECISION_MODEL=clef-flash pnpm test:decision-eval
```

Only the local decision model is called; no text model and no cloud key are configured, so
summaries stay extractive and nothing leaves the machine. `NOCTUA_EVAL_CONCURRENCY=4` triages
several emails at once on servers that handle parallel requests (latency per email then includes
queueing). A failing email is listed under `errors` instead of aborting the run.

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
| `PHISHING_SCORE_HIGH`              | 1.4 of 2 | phishing warning (≈ 70 %)                 |
| `SPAM_SCORE_HIGH`                  | 1.4 of 2 | spam warning / auto-junk candidate        |
| `THREAT_SCORE_SUSPICIOUS`          | 0.8 of 2 | "suspicious" hint, confirms rule signals  |
| `SUMMARY_MIN_PRIORITY`             | 3        | text model writes the summary             |

Priority: the `priority` score (0..4) is rounded and shifted to 1..5.

### Spam and phishing detection

Two layers, combined per mail (`src/main/ai/threat-check.ts`):

1. **Local rules, always on, no AI** (`src/main/mail/threat-signals.ts`, homoglyph helpers in
   `src/shared/confusables.ts`). Each signal carries a phishing weight and a spam weight; the sums
   are the rule scores. Signals: display name names another domain, `Reply-To` on another domain,
   sender domain with look-alike letters from another alphabet (Cyrillic/Greek, also decoded from
   punycode), brand look-alike domain (`paypa1`, `rnicrosoft`, `g00gle`; only real obfuscation
   counts), brand in the display name sent from a freemail address, DMARC fail / SPF or DKIM fail
   (only when the headers were stored), the server's own `X-Spam-Flag`, words mixing Latin with
   Cyrillic/Greek letters, invisible zero-width characters between letters, text-direction
   controls, link text naming another host than the target, links to IPs, homoglyph or look-alike
   hosts, punycode hosts, `user@host` tricks, `javascript:`/`data:` URLs and URL shorteners, input
   forms, pressure phrases together with links, requests for bank details, credentials or a
   fee, a brand in the display name sent from a domain that is not the brand's, an executive
   title ("CEO", "Geschäftsführer") from a freemail address, a payment to be kept confidential,
   executable / macro / HTML-SVG attachments and double extensions, spam phrases, shouting
   subjects, image-only mails and hidden text. The brand, freemail and shortener lists cover
   major services, regional banks, parcel carriers and tax authorities; company editions add their
   own brands and trusted domains via the org configuration (`security`, see `docs/ORG-CONFIG.md`). Mails from
   known contacts get a spam discount. Signals are recomputed on demand and never stored, so better
   rules apply to old mail too.
2. **Decision model** (optional): the hybrid triage asks `phishing` and `spam` (each a score 0..2)
   with the signal lines in the `state`. Mails that never went through hybrid triage (older than
   the triage window, other folders, triaged before the model was enabled) get a separate
   check (`THREAT_QUESTIONS`, one call per question) when the rules flag them and the mail is opened; the
   result goes to `mail_threat_checks` (migration 035).

Levels (`combineThreatLevel` in `src/shared/decision-thresholds.ts`): model score ≥ 1.4 → high;
model ≥ 0.8 plus rules ≥ the "suspicious" rule threshold → high; model ≥ 0.8 or rules ≥ the
"suspicious" threshold → suspicious; rules ≥ the "high" threshold → high on their own. Rule thresholds:
phishing 3 / 6, spam 3 / 5.

The email view shows a banner for phishing (high: "Diese E-Mail sieht nach Phishing aus – klicke
keine Links, gib keine Zugangsdaten ein.", suspicious: a quieter hint) or spam, lists the warning
signs and offers "Move to junk" in the inbox. Noctua moves mail on its own **only** if the user turns
on Settings → Privacy → "Move likely spam to junk automatically" (`security.autoJunk`): then a
freshly triaged inbox mail goes to Junk when spam or phishing is high **and** the model itself says
at least 0.8 **and** the sender is not a known contact. Rules alone never move mail.

#### Evaluation

`test/ai/threat-rules-eval.test.ts` runs the local rules on the labelled set of 32 German and
English emails (`test/local/decision-eval.dataset.ts`) in CI. Rules only, no model:

| Group                                                                             | Emails | Warned (suspicious or high)                |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------ |
| Legitimate (personal, work, newsletter, promotions, notifications, transactional) | 23     | 0                                          |
| Likely phishing                                                                   | 5      | 5                                          |
| Spam                                                                              | 6      | 5 (cold SEO outreach is left to the model) |

`pnpm test:decision-eval` adds the decision model and reports, per mode, the combined levels:
warning banners on legitimate emails and on newsletters/promotions, recall of any warning, and the
emails "Move likely spam to junk" would move (which must never include a legitimate one). It
needs a reachable Ollama with a decision model; results are written to `test/local/out/`.

### Rules with an AI condition

A rule may carry `aiCondition` (natural-language yes/no question, ≤ 200 characters, e.g. "Ist das
eine Rechnung?"). After triage Noctua asks the decision model all AI conditions of all enabled rules
whose other criteria already match, one `noul` call per rule (at most 16 per mail; 64 in one
combined call with `ai.decisionMode = single`). A
rule fires if its probability is ≥ 0.6 and all other conditions match. Without a decision model
(or when the call fails) rules with an AI condition are skipped; the rules list shows a hint. The
condition text is authored by the user (trusted); the mail content is passed as untrusted data
(SEC-15).

## Prompt language

All prompts, decision-model questions and labels sent to models are English. Text the models write
for the user (one-line summaries, task titles, event titles, rule names, style-profile notes) follows
the app language (`ui.language`: `en` → English, otherwise German), via
`src/main/ai/output-language.ts`. Owl answers follow the language of the question; drafts and
nudges follow the language of the conversation or the dictated idea. Heuristics that match mail
content (salutations, forwards, scam and scheduling phrases) stay bilingual on purpose.

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
- Phishing and spam are hints, not filters (unless auto-junk is switched on); false positives and
  negatives are expected. The brand list for look-alike checks is small and hand-picked.
- Mails triaged before decision mode was enabled have no stored decision: the event job keeps
  running the generative extraction for them.
- Image input (Clef) is not used yet.
