# 28 — Fern model choice: DeepSeek on Nebius vs Claude (2026-11-12)

**Status:** proposed. Measured and written for Kai to decide; no production model was changed.

**Question.** Should Fern (the chat agent, the app's main interface) move from open models on Nebius Token Factory to Claude, for example Claude Haiku 5.5? Kai finds DeepSeek slow. Speed, accuracy and reliability drive retention.

## Answer in one screen

| | DeepSeek V4.1 Flash (today) | Claude Haiku 5.5 | Claude Sonnet 5.5 |
|---|---|---|---|
| Reply finished, median / p90 | **51 s / 110 s** | **18 s / 33 s** (through OpenRouter, an upper bound) | 21 s / 35 s (upper bound) |
| First word of the reply, median | 44 s | 16 s | 18 s |
| Cases passed (80) | 54 | 49 | 51 |
| Judge score (0–1) | **0.896** | 0.788 | 0.854 |
| Cost per message, warm cache → cold cache | $0.0185 → $0.0257 | **$0.0040 → $0.0084** | $0.0756 → $0.1835 |
| Cost per chatting user per month (5.4 messages a day), warm → cold | $3.01 → $4.17 | **$0.65 → $1.36** | $12.29 → $29.83 |

- **Recommendation:** move Fern's chat to **Claude Haiku 5.5** on the **direct Anthropic API**, with prompt caching on, behind a flag, A/B against DeepSeek, **once a prompt pass has closed Haiku's accuracy gap** (below). Keep DeepSeek V4.1 Flash on Nebius as the fallback.
- Haiku is **about 3× faster** at the median and **3–4.6× cheaper per message** than today's model, depending on how warm the prompt cache is in production.
- **Accuracy: Haiku is somewhat behind DeepSeek today.** Its deterministic pass count (49 vs 54 of 80) is not significantly different (paired exact binomial, 8 vs 3, p = 0.23; 95% CI of the gap −1.8 to +14.3 points). That is an underpowered test, not proof of equivalence. The judge scores do separate them: DeepSeek scored higher on 30 cases, Haiku on 9 (sign test p = 0.001, mean gap 0.11). Haiku's losses mostly share one shape: it does less before answering (3.4 chat calls a message against DeepSeek's 5.4). That is a prompt fix to make and measure before the switch.
- Sonnet 5.5 buys no measured accuracy over DeepSeek or Haiku here, at 19× Haiku's cost. It is not worth using as the default.

## What Kai has to decide

1. **An Anthropic API key for production** (the secret `unfurl/third-party` holds none today). The Claude runs here went through OpenRouter's key. Going direct removes a hop and gives first-class caching and thinking controls.
2. **Whether to fund the prompt work and the A/B** (below) before switching. The alternative is switching straight away and accepting a possible small drop in "gathers before answering".
3. **Hybrid routing** (Sonnet for a share of hard turns) is not recommended now. See the cost model.

## Method

- **Cases.** Fern's replay eval (ADR-0029, `backend/tests/eval/fern/`): real Fern turns rebuilt from production chats, each with the records at that moment, the message(s) sent, and deterministic checks (right tool called, right fields written, nothing re-created, asked a multiple-choice question when it should). Each run seeds a fresh user, pins the clock to the message's moment, and sends the message through `companion.services.ask`. That is the same code path as the app, with the real Fern system prompt, tools and tool loop.
- **Sample.** 80 of the 227 cases: all 30 guard cases (things Fern already does right and must keep doing) plus 50 failure cases (past mistakes) chosen by the lowest SHA-1 of the case id. That is deterministic and blind to content. The list is in `subset.txt` with the raw results. The 80 cases send 91 messages; the whole Sonnet leg cost about $7 (Haiku $0.37, DeepSeek $1.69).
- **Models.**

  | Name in tables | Model | Provider | Notes |
  |---|---|---|---|
  | ds | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | Nebius | today's `NEBIUS_MODEL`; thinking switched as production does |
  | mm | `MiniMaxAI/MiniMax-M3.1-Flash` | Nebius | best other Nebius model in the 2026-11-04 comparison |
  | oss | `openai/gpt-oss-120b` | Nebius | cheapest fast reasoning model on Nebius |
  | haiku | `anthropic/claude-haiku-5.5` | OpenRouter → Anthropic | prompt caching on (top-level `cache_control`), provider-default effort |
  | sonnet | `anthropic/claude-sonnet-5.5` | OpenRouter → Anthropic | same, the quality ceiling |

- **Run.** 2026-11-12, one run per case per model (`FERN_EVAL_REPEATS=1`). Each model ran as two parallel shards against its own throwaway Postgres database, so all five ran at the same time of day. The three Nebius legs and the judge shared one Nebius key across six shards while the Claude legs did not, so any Nebius throttling would inflate only the Nebius latencies (not checked; no 429s were logged). The judge is `Qwen/Qwen3-235B-A22B-Instruct-2507` on Nebius, the default judge (no model judged itself).
- **Latency** is per message the person sent, as the app shows it: send → first thing on screen (thinking, text or a tool card), send → first word of the reply, send → reply finished, tool rounds included. **Claude's numbers include the OpenRouter hop and are an upper bound.** A direct Anthropic call should be the same or faster; that is expected, not measured. "First word of the reply" is the first reply text streamed. In some single-message cases (11 of 71 for Haiku, 19 of 71 for DeepSeek, 30 of 69 for MiniMax) that text is narration before a later tool call, which the app may hold back. Measured instead as the start of the final model call, the medians are 14.4 s for Haiku and 39.0 s for DeepSeek, so the ranking holds.
- **Cost** is recomputed from each run's tokens at the providers' list prices (below), not from the app's `cost_minor`. That field prices models missing from `ai_providers/catalog.py` at a generic $1/$3 rate. "Cached" uses the cache-read tokens the provider reported. For Claude, every uncached input token is billed as a cache write (1.25×), so the cached column is an upper bound. "Uncached" bills every input token at the base rate.
- **Model calls** in these tables count chat calls only (`call_seconds`). The app's `ai_usage` also logs one embedding call per message.
- **Code added for this** (eval only; the app's request path is unchanged): `harness.py` now records first-event and first-text times, per-call seconds and cache-read tokens. `test_fern_replay.py` gains `FERN_EVAL_CACHE=1` (sends `cache_control: {type: ephemeral}`) and keeps the provider's cache-read count. `model_compare.py` prints the tables below.

Reproduce one leg:

```bash
cd backend && FERN_EVAL=1 FERN_EVAL_PROVIDER=openrouter FERN_EVAL_MODEL=anthropic/claude-haiku-5.5 FERN_EVAL_CACHE=1 FERN_EVAL_CASES=$(cat <subset.txt>) FERN_EVAL_OUT=<dir> uv run pytest tests/eval/fern/test_fern_replay.py -p no:cacheprovider
```

```bash
cd backend && uv run python -m tests.eval.fern.model_compare <ds-dir> <haiku-dir> ...
```

**Raw results:** `backend/fern-eval-out/2026-11-12-model-choice/` in Kai's main checkout (git-ignored, like earlier runs): one JSON per case per model with the full trace, `compare.md`, `compare.json`, `subset.txt`, and the Nebius price list as fetched.

## Prices used (USD per million tokens)

| Model | Input | Cache read | Cache write | Output | Source |
|---|---|---|---|---|---|
| DeepSeek V4.1 Flash (Nebius) | 0.30 | 0.006 | — | 1.20 | Nebius `/v1/models?verbose=true`, 2026-11-12 |
| MiniMax M3.1 Flash (Nebius) | 0.15 | 0.015 | — | 0.60 | same |
| gpt-oss-120b (Nebius) | 0.15 | 0.10 | — | 0.60 | same |
| Claude Haiku 5.5 | 0.10 | 0.01 | 0.125 | 0.50 | Anthropic model table (claude-api skill, cached 2026-11-03); cache rates as OpenRouter lists them, 2026-11-12. Haiku 5.5's price rises to $0.50 / $2.50 above 100K-token prompts; Fern's calls are about 13K. |
| Claude Sonnet 5.5 | 2.00 | 0.10 | 2.50 | 10.00 | same |

The app's catalogue is out of date: it has no price for MiniMax M3.1 Flash, and `price_minor` falls back to $1/$3 for any model it does not list.

## Results

### Accuracy (80 cases each)

| Model | Passed | Guards kept | Failures now fixed | Checks passed | Judge mean (0–1) | Crashed | Empty replies | Cut off by the step budget |
|---|---|---|---|---|---|---|---|---|
| ds | **54** | 29/30 | 25/50 | 99/130 | **0.896** | 0 | 0 | 0 |
| mm | 53 | 29/30 | 24/50 | 98/130 | 0.816 | 0 | 0 | 1 |
| oss | 43 | 27/30 | 16/50 | 79/130 | 0.738 | 0 | 0 | 0 |
| haiku | 49 | 28/30 | 21/50 | 92/130 | 0.788 | 0 | 0 | 0 |
| sonnet | 51 | 29/30 | 22/50 | 96/130 | 0.854 | 0 | 0 | 0 |

Which differences are real (paired, exact two-sided binomial test on the cases where only one of the pair passed):

| Pair | Only first passed | Only second passed | p |
|---|---|---|---|
| ds vs haiku | 8 | 3 | 0.23 |
| ds vs sonnet | 5 | 2 | 0.45 |
| haiku vs sonnet | 5 | 7 | 0.77 |
| ds vs mm | 6 | 5 | 1.00 |
| ds vs oss | 14 | 3 | **0.01** |

- On the deterministic checks, DeepSeek, MiniMax, Haiku and Sonnet cannot be told apart with 80 cases. ADR-0029 already notes that about a tenth of cases flip between two runs of the same model. gpt-oss-120b is clearly worse.
- On the judge scores, paired per case, DeepSeek beats Haiku (30 vs 9 cases scored higher, p = 0.001) and MiniMax (25 vs 10, p = 0.017). The judge is a single model (Qwen3 235B), so this is one rater's view, but it points the same way as the pass counts.
- **Reliability:** no model crashed or returned an empty reply. One MiniMax turn ran out of steps. Refusals were not detected separately; through the OpenAI-compatible path one would surface as an empty or error reply, and there were none.
- The guard `G-T00-modoff01` (an expense logged with Finance switched off) failed on all five models, on its "reply shows a `module_off` block" check. That points at the case or the harness, not at a model; it is worth a look apart from this decision. Haiku also failed the guard `G-T46-c54bfae1` ("How am I doing?" without reading `nutrition_status`).
- **Where Haiku lost to DeepSeek:** 8 cases. In 4, Haiku answered without first reading the data (`stats_overview`, `nutrition_status` ×3). In 3, it skipped a write or correction the case expected (`save_food` ×2, `edit_meal`). In 1, it did not ask a multiple-choice question about which day was meant. Haiku makes 3.4 chat calls per message against DeepSeek's 5.4. Haiku won 3 cases (`F-T01-6`, `F-T01-7`, `F-T35-3`): re-pulling a corrected pending meal, and following through on a correction. Making Haiku gather and follow through first is a prompt change that can be measured.

### Latency per message (seconds)

| Model | First thing on screen, p50 / p90 | First word of reply, p50 / p90 | Reply finished, mean / p50 / p90 | Chat calls per message | One model call, median |
|---|---|---|---|---|---|
| ds | 9.9 / 25.0 | 44.2 / 105.0 | 62.5 / 51.1 / **109.5** | 5.4 | 8.4 |
| mm | 3.4 / 9.9 | 25.8 / 73.4 | 44.4 / 31.2 / 98.5 | 7.7 | 3.7 |
| oss | 5.6 / 11.4 | 12.4 / 31.8 | 21.4 / 18.1 / 44.8 | 5.8 | 2.3 |
| haiku (upper bound) | 7.5 / 13.6 | 15.7 / 29.3 | 19.7 / **17.8** / **33.1** | 3.4 | 3.7 |
| sonnet (upper bound) | 7.5 / 13.3 | 18.4 / 28.5 | 22.6 / 21.1 / 34.9 | 3.8 | 4.2 |

- DeepSeek's slowness is per call: a median of 8.4 s per model call (thinking is on for every call of a turn, `companion/loop.py`), times 5.4 calls. Haiku is 3.7 s per call, through OpenRouter, times 3.4 calls.
- Haiku's first visible event (7.5 s) is later than MiniMax's (3.4 s) because, through OpenRouter, Claude's thinking is not streamed to the app (Anthropic's default thinking display is "omitted"). The first thing shown is the first tool card. A direct integration with `thinking.display: "summarized"` would stream the plan, as DeepSeek's thinking does today. Not measured here.

### Tokens and cost per message

| Model | Input tokens | Output tokens | Input served from cache | USD, warm cache (as measured) | USD, no caching | USD, cold cache (every input token written) |
|---|---|---|---|---|---|---|
| ds | 71,725 | 3,452 | 34% | 0.0185 | 0.0257 | 0.0257 |
| mm | 107,144 | 5,483 | 83% | 0.0073 | 0.0194 | 0.0194 |
| oss | 59,758 | 2,498 | 92% | 0.0077 | 0.0105 | 0.0105 |
| haiku | 58,540 | 2,082 | **65%** | **0.0040** | 0.0069 | 0.0084 |
| sonnet | 66,606 | 1,703 | 68% | 0.0756 | 0.1502 | 0.1835 |

(Token counts include the one embedding call per message, priced here at chat rates: a small overstatement for every model.)

- **Prompt caching took effect for Claude through OpenRouter:** 65% (Haiku) and 68% (Sonnet) of input tokens were cache reads. Without `cache_control` nothing was cached: the Haiku smoke run read 0 tokens from cache. A probe of two identical calls (13.5K tokens) read the whole prefix from cache on the second call and cost 92% less. Nebius caches on its own. DeepSeek's share is low (34%), so most of today's input is billed at full price.
- **The warm-cache share will be lower in production.** Each shard ran its cases back to back, so the prompt prefix stayed in cache between cases. A person sending 5.4 messages a day will often arrive after the 5-minute cache has expired. Within one turn, the 3–5 calls still reuse the prefix. Real Claude cost should land between the warm and cold columns. Anthropic's 1-hour cache option (writes at 2×) is worth measuring.
- Cross-check with production: the last 28 days cost ₱420 for 455 turns (the retention report's `fern_28d`), about **$0.016 per turn**. The app prices DeepSeek at $0.30/$1.20 with no cache discount, so the like-for-like eval figure is the uncached $0.0257. Eval messages cost about 1.6× a production turn: the cases are chosen from hard moments. **Every per-user dollar figure below is probably high by a similar factor, for every model.** The ratios between models hold.

### Cases passed by topic (topic from the case title; small groups)

| Model | Habit (5) | Meal (28) | Money (5) | Task (5) | Other (37) |
|---|---|---|---|---|---|
| ds | 2 | 22 | 3 | 5 | 22 |
| mm | 3 | 23 | 3 | 4 | 20 |
| oss | 4 | 16 | 2 | 3 | 18 |
| haiku | 2 | 18 | 3 | 3 | 23 |
| sonnet | 2 | 20 | 3 | 5 | 21 |

Meal logging, the largest group, is where Haiku trails (18 vs 22 of 28), consistent with "reads less before writing".

## Cost model

**Usage measured in production** (`scripts/retention_report.py`, a read-only one-off ECS task, 2026-11-12, last 28 days): 455 Fern turns from 3 people chatting, 2,521 model calls. That is **5.4 messages per chatting person per day** and 5.5 `ai_usage` rows per turn (chat calls plus one embedding call). The sample is small and dominated by the team's own use, so heavier scenarios are shown too.

Per chatting user per month (30 days), warm cache as measured (cold-cache figures in the line after the table):

| Model | 5.4 / day (measured) | 20 / day (heavy) | 60 / day (Plus hard stop) | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|---|---|---|
| ds (today) | $3.01 | $11.11 | $33.34 | $301 | $3,009 | $30,095 |
| mm | $1.19 | $4.39 | $13.16 | $119 | $1,188 | $11,879 |
| oss | $1.26 | $4.64 | $13.91 | $126 | $1,256 | $12,561 |
| **haiku** | **$0.65** | **$2.41** | $7.24 | **$65** | **$653** | **$6,532** |
| sonnet | $12.29 | $45.37 | $136.10 | $1,229 | $12,287 | $122,866 |

(User counts assume every user chats at 5.4 messages a day. That overstates the bill: in production 3 of 5 active loggers chatted.)

Cold cache (every input token written, Claude; base price, Nebius): Haiku $1.36, DeepSeek $4.17, MiniMax $3.15, gpt-oss $1.70, Sonnet $29.83 per user per month at 5.4 messages a day. Haiku stays the cheapest either way (3× under DeepSeek cold, 4.6× warm).

**Routing variants** (per message, then per user per month at 5.4 a day):

| Variant | USD / message | USD / user / month | Note |
|---|---|---|---|
| Haiku only | 0.0040 | 0.65 | recommended |
| Haiku + 30% small talk on Nemotron 3.5 Lightning | 0.0031 | 0.50 | estimate, not measured (a small-talk message assumed at 15K tokens in, 300 out); saves about $0.15 a user; needs a classifier and a second model's prompt to maintain; not worth it yet |
| Haiku + 10% hard turns on Sonnet | 0.0112 | 1.82 | Sonnet showed no measured accuracy gain |
| Haiku + 20% on Sonnet | 0.0183 | 2.98 | as expensive as today |
| Haiku, 2% of turns falling back to DeepSeek | 0.0043 | 0.70 | the recommended fallback |

**Against Plus pricing** (brand docs: US$6.99 a month or $49.99 a year; ADR-0038: a $2.50 monthly AI budget at tier 1, then the light model, with a hard stop at $5):

- Today, a typical chatting user costs $3.01 a month on DeepSeek. That is past the $2.50 tier-1 budget, so a typical Plus user would be moved to the light model around day 25. A heavy user ($11.11) is cut off at the $5 hard stop in under two weeks.
- On Haiku, the typical user costs $0.65 to $1.36, warm to cold (26–54% of the budget), and the heavy user $2.41 warm, about $5 cold. Plus at $6.99 keeps about $5.94 after the App Store's 15% small-business commission. Haiku leaves most of that as margin, even at 20 messages a day.
- The free allowance (15, then 5 messages a day) costs at most $0.06 a day per free user on Haiku, against $0.28 on DeepSeek.
- KPI 9 (docs/25) sets a bar of ₱25 of AI cost per active logger per 28 days. Production is at ₱84 today. At the measured rate Haiku would be about ₱35 per chatting person, or about ₱21 per active logger.

## Recommendation

1. **Model:** Claude Haiku 5.5 for Fern's chat purpose. It costs least of everything tested and is the fastest with the best tail (p90 33 s through OpenRouter against DeepSeek's 110 s). Its accuracy is somewhat behind today's model: level on deterministic checks within this sample's power, behind on the judge (p = 0.001). **The switch is gated on the rollout's prompt pass closing that gap.** If it cannot, the next candidate is gpt-oss-120b's speed with DeepSeek's accuracy, which nothing here offers; Sonnet does not close it (0.854 judge) at 19× the cost.
2. **Routing:** one model. No small-talk router and no Sonnet escalation until an eval shows a turn type where Sonnet passes and Haiku does not. One model also means one prompt cache.
3. **Caching:** on, as automatic caching (top-level `cache_control: {type: "ephemeral"}`). The Fern system prompt and tool list must stay byte-stable across calls: no timestamps or per-turn ids ahead of the conversation. Watch `cache_read_input_tokens`; a turn with 0 means something in the prefix changed.
4. **Latency budget** (per message, measured as in this doc):

   | Moment | Target p50 | Target p90 | Haiku via OpenRouter today | DeepSeek today |
   |---|---|---|---|---|
   | First thing on screen | ≤ 2 s | ≤ 4 s | 7.5 / 13.6 | 9.9 / 25.0 |
   | First word of the reply | ≤ 10 s | ≤ 20 s | 15.7 / 29.3 | 44.2 / 105.0 |
   | Reply finished | ≤ 15 s | ≤ 30 s | 17.8 / 33.1 | 51.1 / 109.5 |

   Haiku nearly meets the "finished" budget already. The first-on-screen target needs streamed thinking summaries, plus a look at the time spent before the first model call. That time is identical on every model, and in this run nothing showed earlier than 3.4 s (MiniMax's median first event).
5. **Reliability ("what I type gets logged, even if I close the app"):** that is a property of the turn running server-side and of the write path, not of the model. The model contributes failed or skipped tool calls. Haiku had no crashes, empty replies or cut-off turns. Keep the fallback (below) so a provider outage does not drop a message.

### What changes in code (`backend/app/modules/ai_providers`)

- **A native Anthropic factory.** `public.model_factory` builds every model as `ChatOpenAI` against an OpenAI-compatible URL (`PRESET_BASE_URLS`, which already lists Anthropic's). Add an `anthropic` branch that builds `langchain_anthropic.ChatAnthropic` (it wraps Anthropic's official SDK), so prompt caching, `thinking: {type: "adaptive", display: "summarized"}`, `output_config.effort` and `stop_reason: "refusal"` are first-class. Claude Haiku 5.5 rejects non-default sampling parameters (`temperature`/`top_p`); check the loop sends none. Its default effort is `medium`; set it explicitly.
- **Settings:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-5-5`, and a `_server_default` branch for `DEFAULT_LLM_PROVIDER == "anthropic"`. The key lives in `unfurl/third-party` as `anthropic_api_key` and is wired through `infra/lib/backend-env.ts`.
- **Thinking switches:** `speed_options` and `thinking_options` key off the model name (DeepSeek, Qwen3). Add the Claude case: thinking stays on (Haiku 5.5 accepts `disabled` only at effort `high` or below, and thinking is what streams the plan), effort `low` or `medium` to be measured, display `summarized` so the plan streams to the app's thinking row.
- **Usage and price:** `capture.agent._stream_usage` keeps only input and output tokens, so cache reads and writes are lost and `cost_minor` overstates a cached call. Extend it, and `price_minor`, with cache read and cache write prices. Add Claude Haiku 5.5 and Sonnet 5.5 to `catalog.py`, and fix the stale and missing Nebius prices (MiniMax M3.1 Flash is missing).
- **Fallback:** in the model call, on a 429, 5xx, connection error or timeout before the first token, retry the same call once on Nebius DeepSeek V4.1 Flash, and record the switch in `ai_usage`. Thinking blocks are model-bound: the fallback call must not resend Claude thinking blocks to DeepSeek.

### Rollout

1. **Prompt pass first:** run this eval's 80 cases on Haiku through the direct API, with the native factory, caching and summarized thinking. Then tune the "read before you answer, follow through on corrections" instruction until Haiku's pass count is at least DeepSeek's 54 and its paired judge scores show no significant gap (two runs, to see past the run-to-run flips). Then run all 227 cases once.
2. **Flag:** `FERN_CHAT_PROVIDER` (server setting, no release) chooses the provider for the chat purpose. `FERN_CLAUDE_SHARE` (0–100) sends that percentage of accounts, by a stable hash of `owner_id`, to Claude.
3. **A/B:** start at Kai's account, then 50% for two weeks. Compare per arm: turns per chatter, logs per active day (docs/25 KPIs 1 and 8), `ai_usage` cost per turn, how often a reply is followed by a correction ("no, …", undo), and the fallback rate.
4. **Fallback** on from the first day. Switch everyone when the Claude arm is at least level on logs and corrections, then make DeepSeek fallback-only.
5. Re-run this comparison when Nebius or Anthropic change models or prices; `model_compare.py` and the subset make it a one-command job.

## Not measured

- **Claude through the direct Anthropic API.** Every Claude number here went through OpenRouter. Latency is expected to be an upper bound; accuracy and tokens should carry over.
- **Cache warmth in production.** See the cold-cache column.
- **Haiku at a tuned effort, or with summarized thinking.** Both ran at the provider's default. OpenRouter did not report which effort it sent.
- **Vision (photo and label reading) and voice transcription.** Other purposes, other models; only the chat purpose was tested.
- **Variance:** one run per case. Pass counts move by about ±4 between identical runs (ADR-0029's "a tenth flip").
- **Free-user behaviour at scale:** the usage rate comes from 3 people.
