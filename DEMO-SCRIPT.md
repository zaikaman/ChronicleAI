# ChronicleAI Demo Script

Target duration: approximately 4 minutes 30 seconds to 4 minutes 50 seconds. Hard maximum: 5 minutes.

Audience: hackathon judges, including non-technical reviewers.

Core story: **ChronicleAI is an AI research desk that watches important wallets, earns money by selling intelligence, and uses that revenue to make carefully controlled onchain moves.**

The video uses two simple ideas:

**Watch → Earn → Act**

**Real transaction → Public proof**

The narration should stay in plain English. Technical terms can remain visible in the product UI for technical judges, but they should not drive the voiceover.

## Before recording

Prepare one real example of each item:

- An active Watch campaign for a wallet, contract, or protocol.
- A real Telegram DM delivered by that campaign for a matching event.
- A paid intelligence or Watch receipt. If it did not fund the exact transaction shown later, describe it as revenue that supports the desk rather than claiming a direct payment-to-trade link.
- A desk proposal with visible safety checks.
- A completed KeeperHub execution with a real transaction hash.
- The corresponding block explorer page, ready to open at the end.

Never use a fabricated Telegram message, fake success state, or pending transaction presented as completed. If a live event is difficult to reproduce, use a real previously delivered alert and describe it as a recent campaign result.

## Timeline and script

| Time | Visual direction | Narration | On-screen text |
| --- | --- | --- | --- |
| **0:00–0:15** | Opening title card. Use a clean dark background with the existing chartreuse accent. No UI yet. | “Most crypto tools stop at telling you what happened. ChronicleAI takes the next steps: it watches important wallets, earns money by selling intelligence, and can turn that revenue into carefully controlled onchain action.” | **Watch. Earn. Act.**<br><br>An AI desk that turns intelligence into verified onchain action. |
| **0:15–0:35** | Keep the first slide on screen. Animate or reveal the three words one at a time. Do not show an architecture diagram. | “The story is simple. A customer asks ChronicleAI to watch something important. People pay for useful intelligence. Then the desk can use its operating revenue to make a carefully checked move.” | **WATCH → EARN → ACT** |
| **0:35–1:05** | Open `/watch`. Show the page title and the Watch / Alert / Report flow. Pause on the sentence explaining that the service monitors any wallet, contract, or protocol. | “First, imagine that you care about a wallet but do not want to watch it all day. You open ChronicleAI’s Watch service and choose the wallet, contract, or protocol that matters to you.” | **WATCH**<br>Monitor what matters. |
| **1:05–1:25** | Show the campaign form or an active campaign. Point to the target, campaign window, paid status, and any visible receipt or proof link. | “You choose the monitoring window and start a paid campaign. ChronicleAI keeps watch during that window and records the campaign so the result is not just a message in a chat.” | **Paid monitoring campaign**<br>Target selected<br>Campaign active |
| **1:25–1:55** | Show the real Telegram DM. Hold long enough to read the target, event summary, timestamp, and proof link. Redact personal chat details if necessary. | “When something relevant happens, the customer gets a Telegram message. It explains what happened in plain language and gives the customer a way to verify that the event was real.” | **Telegram update**<br>Matching event detected<br>Proof available |
| **1:55–2:20** | Open the Watch campaign detail or show the final report and its onchain receipt. Use a slow zoom or cursor highlight on the report and receipt link. | “At the end of the campaign, ChronicleAI can produce a deeper report and publish it with an onchain receipt. Monitoring, delivery, and the final report are all part of the paid service.” | **Campaign report**<br>Published with proof |
| **2:20–2:50** | Show `/premium` or the paid Watch receipt. Keep the price, payment status, and receipt visible. Do not explain wallet signatures or payment protocols. | “This is the Earn part of the loop. Customers pay for deeper analysis and personalized monitoring. That revenue gives the desk capital to operate.” | **EARN**<br>Paid intelligence and monitoring |
| **2:50–3:05** | Briefly show the premium receipt or revenue record in the product. Keep this short; the purpose is to connect the service to the desk, not to explain payment infrastructure. | “The important point is not the payment technology. It is that useful information becomes a real product with real revenue.” | **Useful information → Revenue** |
| **3:05–3:35** | Open `/desk`. Show the treasury summary and latest proposal. Let the viewer read the proposed action before moving on. | “Now we move to the desk. The desk sees an opportunity for its funds. ChronicleAI can recommend a move, but the AI cannot move money by itself.” | **ACT**<br>A proposal for the treasury desk |
| **3:35–3:55** | Move to the safety status, health checks, pause state, and approval result. Highlight the final decision rather than every metric. | “Before anything happens, ChronicleAI checks its safety limits. It considers the desk’s health, size limits, and whether the system is allowed to act. If the checks do not pass, the desk holds.” | **AI proposes**<br>**Safety rules decide** |
| **3:55–4:15** | Open `/activity` and focus on the relevant KeeperHub run. Show the execution status, KeeperHub run ID, route, and transaction link. | “When the move is approved, KeeperHub handles the real transaction. It is the execution layer that turns the approved decision into an onchain action.” | **KeeperHub executed**<br>Real workflow<br>Real transaction |
| **4:15–4:40** | Follow the transaction link to the block explorer. Keep the confirmed status, chain, timestamp, and transaction hash on screen. | “ChronicleAI records the result in its activity trail, then links to the confirmed transaction. This is not a simulation or a prediction. It is the public record of what happened.” | **PROVE**<br>Confirmed onchain transaction<br>Publicly verifiable |
| **4:40–4:50** | Closing title card. Use the second and final slide. | “Information creates revenue. Revenue enables controlled action. Every action leaves public proof.” | **Real transaction → Public proof** |

## Surface order

Record the browser flow in this order:

1. [`/watch`](https://chronicle-ai-web.vercel.app/watch)
2. Active Watch campaign detail or final report
3. Telegram DM
4. [`/premium`](https://chronicle-ai-web.vercel.app/premium) or the paid Watch receipt
5. [`/desk`](https://chronicle-ai-web.vercel.app/desk)
6. [`/activity`](https://chronicle-ai-web.vercel.app/activity)
7. Confirmed block explorer transaction

Use one story and one transaction. Do not jump between unrelated alerts, campaigns, or transactions.

## Recording direction

- Keep the browser at a readable zoom and hide unrelated tabs, bookmarks, wallet secrets, and notifications.
- Use captions matching the narration. The key message should remain understandable with audio muted.
- Hold on the Telegram message, KeeperHub execution, and confirmed transaction for at least three seconds each.
- Use simple cuts between surfaces. Avoid showing code, architecture diagrams, or payment protocol details in the main video.
- Keep the cursor visible when it points to a campaign, receipt, execution status, or transaction link.
- Do not call a desk condition a “market alert” unless the screen is actually showing an external market observation. Say “something important happened” or “the desk found an opportunity.”
- Do not say that a specific customer payment funded the displayed transaction unless the product records that exact causal relationship.
- Keep “ERC-20,” “event classification,” “ingestion pipeline,” “MCP,” “x402,” “MPP,” “APY differential,” and “preflight” out of the narration. They may remain visible as small UI labels.

## Final review checklist

Before submitting, confirm that the video answers these questions without requiring technical knowledge:

- What does ChronicleAI watch?
- Why would someone pay for it?
- What does the desk do with the revenue?
- What stops the AI from moving money freely?
- Did KeeperHub execute a real transaction?
- Where can the viewer verify the result?

The final frame should leave the viewer with one sentence:

> ChronicleAI turns useful onchain information into revenue, controlled action, and public proof.
