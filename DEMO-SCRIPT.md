# ChronicleAI — Demo Script (≤ 5 minutes)

**Goal:** Win on the criteria that matter for *The Last Mile* — a real KeeperHub execution, reliability, and a product someone would actually run.

**Total runtime target:** **4:30** (hard cap **4:55**). Leave 5 seconds of silence at the end for judges to screenshot the tx.

**Primary live base URL:** `https://chronicle-ai-web.vercel.app`

**Hero proof tx (pin this in the description too):**
[Sepolia · Desk Oracle Arbitrage · private route](https://sepolia.etherscan.io/tx/0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6)

---

## One-sentence pitch (memorize this)

> ChronicleAI watches onchain activity, sells a $4.99 Chronicle Pass for deeper intelligence, routes that revenue through hard safety rules into a treasury desk, executes through KeeperHub, and publishes the proof.

That is the whole product. Everything else is evidence.

---

## What judges must walk away knowing

| Judging axis | What this demo proves |
| --- | --- |
| **Onchain via KeeperHub** | Real Sepolia tx + KeeperHub run ID on Activity / ticket |
| **KeeperHub surfaces** | Workflows, MCP path, private routing, gas/routing labels, audit trail |
| **Reliability** | Policy gate → preflight dry-run → fail-closed private route → audit timeline |
| **Usefulness** | Not a chat bot that “might trade” — a funded intelligence business that can act |
| **Integration quality** | Clean public UI: Alerts → Desk → Ticket → Activity → Explorer |

---

## Demo route (click path)

Record this exact path. Do not improvise mid-take.

```
1. /                          Hero — “Watch. Earn. Act.”
2. /alerts                    Public intelligence + causal chain
3. /alerts/:id                One Alert with signal / policy / action links
4. /desk                      Policy gate, HF, kill switch, capital
5. /desk/tickets/:ticketId    Execution audit (preflight → submit → outcome)
6. sepolia.etherscan.io/tx/…  Independent verification
7. /activity?filter=desk      Full audit trail + routing labels
8. (optional 8s) /watch       Premium monitoring product beat
```

**Do not open:** Affiliates, FAQ walls, code editors, raw JSON, or more than one ticket.

**Tabs to pre-open before recording (left → right):**

1. `https://chronicle-ai-web.vercel.app/`
2. `https://chronicle-ai-web.vercel.app/alerts`
3. One strong alert detail (see prep below)
4. `https://chronicle-ai-web.vercel.app/desk`
5. One filled ticket with execution audit
6. Etherscan hero tx
7. `https://chronicle-ai-web.vercel.app/activity?filter=desk`
8. (optional) `https://chronicle-ai-web.vercel.app/watch`

---

## Pre-recording checklist (~15 minutes)

Do this **before** the camera rolls. A cold live demo is how good projects lose.

1. **Hard refresh every tab** so live data is warm.
2. **Pick one Alert** that shows a causal chain (signal status + policy or action link). Prefer a desk-trigger or market alert that clearly connects to a desk decision.
3. **Pick one filled ticket** on `/desk/tickets/:id` with:
   - strategy label (e.g. oracle arb / yield rotation)
   - **Execution audit timeline** visible (preflight → submit → outcome)
   - tx hash + **Private route** badge when it is a desk trade
4. **Confirm hero tx** opens on Etherscan and shows Success.
5. **Confirm Activity desk filter** shows KeeperHub run IDs / routing labels.
6. **Kill switch must be clear** and desk not paused (unless you intentionally demo a hold — not recommended for the main take).
7. **Silence notifications.** 1080p, 60fps if possible. Dark theme is the product default — stick to it.
8. **Mic test:** speak the one-sentence pitch once. If you stumble, rewrite nothing — just re-record that line.

### If live data is thin (backup plan)

Use the README deep-proof set. Still show the product UI first, then land on a known-good ticket + Etherscan:

| Story beat | Backup tx |
| --- | --- |
| Desk private-route fill | `0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6` |
| Yield rotation | `0xa6ccb2467f04e4159a0219fba7a3de307a2e196487cc6242d80493b851279d2a` |
| Registry publish (public / sponsorship path) | `0x4acf30c4948dd0ddcde8c1377af22fc1c6acd01662b7470a785ae293bcc62f6a` |
| MCP → REST recovery (reliability story) | `0xdeaf6568beed23962733d93e5575d2d8b182ee2d5f691609bb137a5f36166956` |

---

## Timed script

Speak at a calm desk-reporter pace. **Do not rush the middle.** The middle is the win.

### Beat 0 — Cold open (0:00 – 0:20)

**On screen:** Home `/`

**Say:**

> Most agent demos stop at reasoning. The hard part is the last mile — turning a decision into a real onchain transaction that actually lands.
>
> ChronicleAI is an AI research desk that watches markets, earns from intelligence, and only then acts through KeeperHub — with public proof.

**Do:** Hold hero for ~3s. Cursor idle. Let “Watch. Earn. Act.” and the live dashboard read.

**Cut rule:** If the hero feels empty, still move on at 0:20. Do not scroll the marketing page.

---

### Beat 1 — Watch: intelligence is public (0:20 – 0:55)

**On screen:** `/alerts` → click your pre-chosen alert → `/alerts/:id`

**Say:**

> First, it watches. ChronicleAI turns important onchain activity into plain-language Alerts — wallet moves, protocol events, desk conditions — with sources and publication proofs.
>
> This is not a private bot log. The market view is public. That is the product surface readers actually open.

**Do:**

1. Land on Alerts list (2s).
2. Click one strong alert.
3. Scroll just enough to show: title, summary, source/proof, and **causal chain** chips if present (signal / policy / action).

**What judges should notice:** Alert is real, sourced, and already linked to the desk path.

---

### Beat 2 — Earn: revenue funds the desk (0:55 – 1:20)

**On screen:** Stay on alert detail OR briefly flash `/subscription` or Premium teaser on the same page if visible — **max 15–20 seconds total**. Prefer narrating from the alert page rather than a full subscribe flow.

**Say:**

> Deeper analysis is productized. Humans unlock it with Chronicle Pass at four ninety-nine a month. Machine clients can pay per item over x402 or MPP.
>
> That revenue is what funds a real treasury desk — so the agent is not pretending every observation is a trade.

**Do:** Do **not** complete a live wallet payment in the main take. It burns time and fails often on camera. Name the rails; show the business model in one breath.

**Optional 5-second visual:** if a premium teaser or Pass CTA is already on screen, hover it. Otherwise skip.

---

### Beat 3 — Act: policy before execution (1:20 – 2:05)

**On screen:** `/desk`

**Say:**

> When capital might move, the LLM only proposes. Hard policy decides.
>
> Health factor floors, position caps, minimum AUM, pause state, kill switch — pure deterministic gates. The model cannot self-approve a trade.

**Do:**

1. Show Live / pause / kill-switch badges.
2. Point cursor at health factor + policy numbers for ~3s.
3. Briefly show capital / equity if visible.
4. Open intents or the pre-chosen ticket link from desk UI.

**What judges should notice:** Safety is visible product UI, not a README claim.

---

### Beat 4 — The last mile: KeeperHub execution (2:05 – 3:25)  ★ core

**On screen:** `/desk/tickets/:ticketId` → expand execution audit → open tx

**Say:**

> Here is the last mile.
>
> This ticket is one full path: Signal → decision → policy → KeeperHub workflow.
>
> Before broadcast, ChronicleAI dry-runs the material legs — including multi-step paths like approve then swap. If preflight fails, we record it. We do not invent a fill.
>
> Desk strategies submit on KeeperHub’s private route. Registry writes use the public path with sponsorship preferred. We label routes honestly from what actually returned — not marketing words.
>
> KeeperHub executes the workflow. ChronicleAI shows the run, gas narrative, and the transaction hash.

**Do (slow, deliberate):**

1. Show ticket headline + strategy + outcome badge (filled).
2. Scroll to **Execution audit timeline**.
3. Hover/expand stages in order: **preflight → submit → outcome**.
4. Call out: KeeperHub run ID, **Private route** badge, gas if present.
5. Click the tx hash → Etherscan success page.
6. Hold Etherscan for **full 4–5 seconds**. Zoom if needed so the hash is readable.

**This beat is ~80 seconds on purpose.** Judges are trained to distrust demos that skip the receipt.

---

### Beat 5 — Prove: activity trail (3:25 – 4:00)

**On screen:** `/activity?filter=desk`

**Say:**

> Everything is inspectable. Activity correlates policy, KeeperHub logs, routing, and final receipts in one trail.
>
> If MCP transport drops, we fall back to KeeperHub’s REST workflow API, log the failure, and still land the write — same idempotency, no silent duplicates.
>
> Agents can think. KeeperHub lets them act. ChronicleAI makes the whole loop public.

**Do:**

1. Filter = Desk.
2. Scroll one or two desk execution rows with run IDs / routing badges.
3. Do not open five panels.

---

### Beat 6 — Optional product flash + close (4:00 – 4:30)

**On screen:** `/watch` for ~8s **or** skip straight to close if time is tight.

**If showing Watch, say:**

> Watch is a separate paid product — monitor any wallet or contract, get Telegram DMs on matching events, and publish an onchain report when the campaign ends.

**Always close on Etherscan or Activity with the hero tx visible. Say:**

> One requirement for this hackathon: execute onchain through KeeperHub. Here is ours — live, audited, and independently verifiable.
>
> ChronicleAI: watch, earn, act, prove.

**Hold final frame 3–5 seconds. Stop talking.**

---

## Spoken word budget (approx.)

| Beat | Time | Words (target) |
| --- | --- | --- |
| Cold open | 0:20 | ~45 |
| Watch | 0:35 | ~55 |
| Earn | 0:25 | ~40 |
| Policy | 0:45 | ~55 |
| Execution ★ | 1:20 | ~110 |
| Prove | 0:35 | ~55 |
| Close | 0:30 | ~35 |
| **Total** | **~4:30** | **~395** |

If you go long, cut Earn first, then Watch optional flash. **Never cut Beat 4.**

---

## B-roll / cutaways (optional, only if editing)

Use only if you are editing a second pass. Live continuous take is fine.

| Cutaway | When | Purpose |
| --- | --- | --- |
| Etherscan success | After ticket outcome | Independent verification |
| Routing badge close-up | During Beat 4 | Private vs public honesty |
| MCP→REST log (README case study) | Beat 5 if time | Reliability story |
| Registry contract page | Final 2s | Anchored publication surface |

---

## What NOT to say

- “MEV-proof” / “never fails” / “fully autonomous money printer”
- “We simulate” without naming **KeeperHub preflight / dry-run**
- “Sponsored gas” on a private-route desk trade (they are mutually exclusive)
- Long framework laundry lists (LangChain is fine **once**, not a tour)
- “Imagine if…” — show the receipt instead

---

## Submission package (align video with DoraHacks fields)

When you upload the BUIDL:

| Field | Value |
| --- | --- |
| Source | `https://github.com/zaikaman/ChronicleAI` |
| Demo video | This script, ≤ 5 min |
| Tx proof | `https://sepolia.etherscan.io/tx/0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6` |
| Live desk | `https://chronicle-ai-web.vercel.app/desk` |
| Live activity | `https://chronicle-ai-web.vercel.app/activity` |
| Live alerts | `https://chronicle-ai-web.vercel.app/alerts` |
| Registry | `0xD8Deb4475a7E23E194Bc93f8739858Fb20744111` (Sepolia) |

**Video description (paste under the upload):**

```text
ChronicleAI — Watch. Earn. Act. Prove.

AI research desk that monitors onchain activity, sells Chronicle Pass ($4.99/mo),
routes revenue through hard policy into a treasury desk, and executes via KeeperHub
with public audit trail.

Hero tx (KeeperHub private route, desk oracle arb):
https://sepolia.etherscan.io/tx/0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6

Live: https://chronicle-ai-web.vercel.app
Code: https://github.com/zaikaman/ChronicleAI
```

---

## Recording day run-of-show

1. Run the pre-recording checklist (15 min).
2. Do **one full silent click-through** of the demo route (2 min).
3. Record **Take 1** continuous (no edits required).
4. If Take 1 is ≥ 5:00 or flubs Beat 4, record **Take 2** only.
5. Prefer the take where Etherscan is readable and you sound calm — not the take with more features.

**Time to record after prep:** ~10 minutes for two takes.

---

## Judge-facing “why this wins” (do not read on camera)

Keep this in your head, not in the voiceover:

1. **Execution-weighted hackathon** → hero is a real KeeperHub-filled desk trade, not a chat transcript.
2. **Last-mile thesis** → policy + preflight + private route + audit = you understood failure modes.
3. **Real business loop** → Watch / Pass / Desk is more useful than “agent that swaps once.”
4. **Honest routing** → private desk vs sponsored registry shows integration maturity.
5. **Inspectable UI** → judges can re-walk Alerts → Desk → Ticket → Activity after the video.

---

## Quick cue card (print or second monitor)

```
0:00  /            Last mile. Watch. Earn. Act. Prove.
0:20  /alerts      Public intelligence + causal chain
0:55  (narrate)    Pass $4.99 · x402/MPP machines · funds desk
1:20  /desk        LLM proposes · policy decides
2:05  /ticket      Preflight → KeeperHub → private route → tx
3:10  Etherscan    Hold success 5 seconds
3:25  /activity    Audit trail · MCP fallback · prove
4:00  close        “Here is our KeeperHub execution.” STOP
```
