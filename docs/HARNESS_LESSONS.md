# Harness lessons: what the agent layer can take from other harnesses

This page compares the agent layer in the app (`apps/host/server/agent/`, plus the DeepSeek
Harness integration in `integrations/harness/`) with four mature coding-agent harnesses, and
lists what Strata can take from each. It is written for developers who work on the agent layer.

> **Status: static analysis.** Every item below was read from source, not measured in Strata.
> Numbers quoted from other projects carry the file path they were read from. Per
> [CONTRIBUTING.md](../CONTRIBUTING.md), an adopted item should land with its own measurement.

Sources compared (all read 2026-11-08, from the same reference collection):

| Project | What it is |
| --- | --- |
| Kimi Code CLI | Python CLI coding agent, model-agnostic (`src/kimi_cli/`) |
| Claude Code | Anthropic CLI, TypeScript + Ink (restored desktop source) |
| Codex | OpenAI CLI, Rust (`codex-rs/`) |
| DeepSeek Harness | the Cordis monorepo Strata wraps (`packages/`) |

## The one constraint that rules them all

The app runs a local model in a small window. Three measured numbers set the rules:

- The Harness system prompt plus its tool definitions already fill about 29K of the 32K window.
  An 8K output budget then makes every turn fail with "request exceeds the context window", so
  the integration had to cut output to 2048 (`integrations/harness/profile/cordis.patch.yml`,
  comment block on the `llm-pi-ai` entry).
- Harness prompt footprints, measured by `strata connect --check` (`strata_cli/launch/harness.py`,
  table near line 173): Claude Code 15.6K tokens (20 tools), Codex 8.6K, opencode 7.4K,
  Hermes 12.9K (20 tools), pi 1.5K (3 tools). Test baseline constants: `TESTED_CONTEXT = 32768`,
  `OUTPUT_CAP = 4096`, `COMPACT_AT = 15000`.
- The Harness prices text at 4 characters per token; engine measurements on real agent traffic
  showed 2.09. One session: the engine counted 59,048 tokens, the Harness 31,794
  (`apps/host/server/agent/context-budget.mjs`, header comment).

So prompt and tool diet is the first lever. Everything below serves that constraint, or the
reliability of long analysis runs inside it.

## What the agent layer already does right (do not duplicate)

- Budget calibration from real traffic: token density is learned from engine-reported prompts,
  and summary splitting never cuts between a tool call and its result (`context-budget.mjs`).
- A pre-send fit check against the engine tokenizer, with three outcomes:
  send / summarize / too-large (`context-fit.mjs`).
- Pure counting guards instead of trusting the model: `turn-guard.mjs` stops a turn after
  3 consecutive search failures, 10 (plan) or 25 (normal) searches, 4 plan rewrites,
  93% context use, or an 85% silent window.
- `reply-cut.mjs`: streaming tool-draft tracking, plus a "write in smaller pieces" nudge when a
  reply is cut (this fixed the AGENT-LOST loss).
- `strata connect --check` validates semantics, not just reachability: one prompt must answer
  "pong", one tool call must carry the right argument — and it records each harness's measured
  prompt footprint.
- Engine side: tool-call recovery reads malformed calls at 98.3% versus 92.9% without it
  (DETAILS.md, tool call recovery), and "requests are never truncated" is an honest contract.

## Lessons from Kimi Code CLI (the largest donor)

Kimi wins same-model comparisons in our reference study. The mechanisms below are the reasons,
and each maps to a concrete landing spot in the app.

1. **Graduated repeat-call ladder with a hard stop.** Kimi injects a system reminder on the 3rd,
   5th and 8th consecutive same-argument tool call (change method → inspect results and change
   arguments → stop calling and summarize), force-stops the turn at the 12th, and reuses the old
   result instead of re-running an exact duplicate call inside one step
   (`kimi/src/kimi_cli/soul/toolset.py`, constants near line 153). DeepSeek Harness already has
   the reminder half (default thresholds `[3, 5, 8]` in `packages/guard/repeat-tool-reminder`);
   what is missing is the force stop and the same-step dedup.
   Landing spot: `turn-guard.mjs` for the counters, a plugin hook for the reminders.
2. **A floor under subagent reports.** When a subagent's final message is shorter than 200
   characters, Kimi runs one forced continuation that asks for technical details, findings, and
   everything the parent needs (`kimi/src/kimi_cli/subagents/runner.py`, constants at lines
   40–48). Our child sessions are projected as one-line cards with no quality floor.
   Landing spot: the delegation result path in the host, before `children.mjs` projects it.
3. **Tool knowledge travels with the tool, and loads on demand.** Kimi keeps each tool's
   description in its own `.md` file (about 1.2 KB each) with bad examples ("`**` blows up the
   context", "avoid node_modules") and a "When NOT to use" section; the system prompt lists only
   skill names and descriptions, and the body loads only when used. This is the architecture our
   29K/32K problem asks for. Our Anthropic-compatible endpoint already implements deferred tool
   loading (`defer_loading` / `tool_reference`, DETAILS.md); pairing the 12 tool switch groups
   with schema-level deferral would make an off-by-default tool cost near zero tokens.
   Landing spot: `tools-catalog.mjs` + the profile builder.
4. **Honest truncation with a next step.** Tool output is capped (50K characters, 2000 per line)
   and the notice says "Output is truncated" plus what to do ("use pagination or more specific
   queries"); shell failures append the last 5 lines of stderr; file reads report total lines and
   which lines were cut. Our spill plugin already keeps head, tail and path; adding the "what to
   do next" sentence and the cut line numbers is a small change with outsized effect.
5. **A structured compaction prompt.** Kimi's compaction prompt ranks what to keep in six
   priority levels (current task state > errors and fixes > code evolution > …), with
   KEEP/MERGE/REMOVE rules and an XML output template (`kimi/src/kimi_cli/prompts/compact.md`).
   At `COMPACT_AT = 15000` we compact often; the summary's shape decides the second half of
   every long task. Landing spot: the summarizer output contract, via a patch or upstream.
6. **Per-step context checkpoints with rollback.** Kimi persists the conversation before every
   model call and can revert to a checkpoint; a companion tool lets the model itself fold dead
   history into one message for "its past self". We have no harness-level rollback today.
7. **Request-level retry with layered recovery.** Retries with exponential backoff on 429/5xx,
   a token-refresh-then-retry path on auth errors. `agent-bridge.mjs` currently retries session
   creation only; model-level failures surface as plain error cards.
8. **Throttled, honest dynamic injection.** Plan-mode reminders arrive every 5 rounds,
   alternating full and sparse text; the injected directory tree says outright that it shows two
   levels and "... and N more" means the agent must explore. Honesty about partial views is
   cheap and prevents wrong conclusions.

## Lessons from Claude Code

1. **Executable error text.** Errors tell the model the repair step: "File has not been read
   yet. Read it first before writing to it." Our gate and ask cards translate commands into
   human words; they can borrow the same discipline for the model-facing side.
2. **Declared tool metadata instead of guessed behavior.** Claude Code tools carry fields like
   `isConcurrencySafe`, `isDestructive`, `interruptBehavior`, `maxResultSizeChars`. Our
   `strata-gate.mjs` infers danger with regexes over commands; a declared-per-tool table (host
   side, one entry per DSH tool) would be both stricter and cheaper.
3. **A circuit breaker on compaction.** Claude Code stops auto-compaction after 3 consecutive
   failures; a code comment records a session that failed 3,272 times in a row. On a local
   engine every failed compaction call is a real prefill cost, so the breaker belongs in our
   compaction path (`context-fit.mjs` side).
4. **Cache stability by construction.** Keep the tool catalog fixed across modes, never mutate
   early messages, send dynamic content only when it changes. Our engine's conversation cache
   already pins Claude Code's per-request billing header and checkpoints the system prompt
   (DETAILS.md, Conversation cache), and one measured local number shows the upside: allowing a
   cache boundary on the last message cut first-edit prefill by 33.1%
   (MESSAGE_BOUNDARY_CACHE.md). Harness-side discipline multiplies that gain.
5. **Anti-hallucination copy for subagents.** Fork results come with "don't peek" and "never
   fabricate or predict fork results". Cheap text, real effect on invented statuses.

## Lessons from Codex

1. **A context-budget tool the model can call** (`get_context_remaining`). The host knows the
   budget (`context-fit.mjs`); the model does not. On a 32K window, letting the model see
   remaining space lets it pace itself.
2. **Tool outputs that report their own truncation** (`original_token_count` in structured
   output). Pairs with the spill plugin: report the measured token count of what was spilled.
3. **A written context discipline, enforced in review.** Codex's repo rules: no rewriting
   history, every injected fragment bounded (10K tokens max per fragment), re-inject on change
   only, and new fragments over 1K tokens need a named review. Adopting this as a house rule for
   `plugins/*.mjs` prevents 32K bloat regressions at review time.
4. **Per-model prompt templates.** Codex dispatches instructions per model from a models table.
   We serve two families (DeepSeek V4.1 and Qwen); persona and reminder text should differ per
   family rather than one prompt for both.
5. **Escalation-shaped approvals.** One ask per escalation with a justification field, an
   approval cache, and persistable prefix rules — fewer interruptions than ask-per-command.
   Fits `strata-gate.mjs` Manual mode: approve the command shape once, not every occurrence.

## Lessons from DeepSeek Harness (align or take upstream)

Strata wraps DSH; several gaps are best fixed upstream so both projects gain.

1. Two-level compaction with a cache-aware summarizer: their `compaction-basic` reuses the
   session prefix for the summarizing call, so the summarizer itself hits the KV cache.
2. Snapshot dedup for runtime context and skill catalogs: resend only on content change
   (their `runtime-context` keeps a retained snapshot for comparison).
3. Remedy suffixes on tool errors ("re-read the file, then retry") and `[exit code: N]`
   markers on shell results.
4. Code Mode (`run_code`): one TypeScript program replaces N tool round-trips — the single
   biggest round-trip saver for a 32K window. Needs an experiment flag and a trust boundary
   before enabling.
5. Confirm the bundle we pin includes the `[3, 5, 8]` repeat reminder guard, so the Kimi-list
   item 1 only needs to add the force stop and the dedup.

## Engine-side prerequisites

Some harness items above need engine work first; listed so they are not lost:

- A token-count endpoint on the OpenAI-compatible side (today only
  `/v1/messages/count_tokens` exists).
- Grammar-constrained structured output; today JSON mode and tool calls are mutually exclusive,
  and `tool_choice: required` is best-effort.
- A second, small model route for titles and summaries, so a small task does not consume the
  main model's window (one model per server today).
- A reproducible sampling mode for eval runs of harness changes.

## Suggested order

Under the 32K window, by lever size:

1. Prompt and tool diet: schema-level defer loading for off-by-default tools; keep the catalog
   fixed across modes.
2. Repeat reminder ladder, plus host-side force stop and same-step dedup.
3. Compaction output contract (keep-priority list), plus a failure breaker in the compaction
   path.
4. Subagent report floor and anti-hallucination copy.
5. Context-remaining tool and token counts on spilled results.
6. Per-step checkpoints with rollback; request-level retry with backoff.

Adopt each item with a measurement — turns to first correct answer, tokens per task, or
compaction frequency — per the rules in [CONTRIBUTING.md](../CONTRIBUTING.md).
