The Last Mile
Most agent hackathons reward reasoning: an agent that decides something clever. The harder problem is what happens next. Agents can detect and decide, but they all hit the same wall when they need to move value onchain. Failed transactions, gas spikes, MEV, no observability, no guarantees.

KeeperHub is the execution and reliability layer that fills it: the last mile between what your agent decides and a transaction that acts onchain. This hackathon is about what you build on top of that.

We reward agents that execute onchain, a working transaction that executes through KeeperHub beats a polished demo that never touches a chain, make sure to build something that runs.

What to build
Every project must use KeeperHub as its onchain execution layer. That is the one requirement. Bring any agent framework you like, ElizaOS, OpenClaw, Hermes, CrewAI, LangChain, AutoGPT, or your own, and let KeeperHub handle the actual execution.

The KeeperHub stack
KeeperHub is open source, so you can inspect exactly what is running your agent's execution.

MCP server / CLI. How your agent discovers and calls KeeperHub's execution capabilities natively. https://docs.keeperhub.com/ai-tools/mcp-server

x402 / MPP. Pay-per-execution over HTTP, settled onchain, indexed on x402scan.com. Or have autonomous payments via Tempo and Stripe. Dual-protocol routing lets clients auto-select between x402 and MPP. https://docs.keeperhub.com/ai-tools/agentic-wallet

Smart Gas Estimation. Intelligent gas pricing that adapts to congestion with exponential backoff, so transactions execute instead of getting stuck.

Private routing. Private mempool routing via non-public submission paths.

Audit trail. Every action logged: trigger, simulation result, submitted transaction, gas used, outcome, timestamp.

Gas sponsorship: KeeperHub offers gas sponsorship on mainnet Ethereum.

Timeline
All times are UTC+2.

July 27, 2026, 12:00 - Hackathon opens.

July 27 to August 13 - Build phase. Roughly 2.5 weeks, with weekly office hours.

August 13, 2026, 12:00 - Submission deadline. Registrations and BUIDL submissions close.

August 13 to 20 - Judging.

August 20 - Winners announced.

Prizes
$5,000 in cash.

Grand Prize. One overall ranking, judged across every submission. The top three projects can come from anywhere, including the same topic area. What matters is that your agent executes real transactions onchain through KeeperHub.

Main prizes

Prize 1st $2,000

2nd $1,200

3rd $800

Bounties.

Awarded separately and stackable with the Grand Prize. A project can place in the top three and still win a bounty.

Total bounties amount: $1,000. This amount will be split among two winners for the Best Onboarding UX Improvement. This bounty rewards the contribution that most improves the new-builder experience, getting someone from zero to their first transaction executed faster: a merged PR to the KeeperHub repo, a starter template, a tutorial, or a clear teardown of where you got stuck with proposed fixes. KeeperHub is open source, so fresh eyes are the fastest way to make it better.

Cash prizes are distributed via stablecoins.

Eligibility
Open to builders worldwide, solo or in teams, 18 and over. You do need to ship a working agent that executes through KeeperHub.

Participants from regions subject to applicable sanctions (including OFAC-restricted jurisdictions) are not eligible, per the DoraHacks platform terms.

Every submission must use KeeperHub as its onchain execution layer. How your agent reasons and decides is entirely up to you.

Judging criteria
Execution is weighted heavily, because that is the point.

Does it execute onchain via KeeperHub? Working transactions, not mockups. Every team links a transaction their agent has executed.

Use of KeeperHub surfaces. MCP server, CLI, x402, MPP, workflow builder, audit trail.

Reliability and observability. Does the build show it understands failure modes? Retries, gas handling, and audit trail usage all count.

Originality and real-world usefulness. Would anyone actually run this?

Integration quality and developer experience. How cleanly is it built?

How to submit
Submit your BUIDL on this page before the deadline. Each submission requires:

A link to your source code on GitHub.
A short demo video showing your agent executing onchain through KeeperHub.
A link to a transaction your agent executed via KeeperHub.
Incomplete submissions cannot be judged, so leave time before the deadline to wrap up.

Support
Questions during the build go to the builder channel, where KeeperHub engineers hold office hours for the duration of the hackathon.

Link tree: https://keeperhub.com/links
Discord ('general' / 'help' channel): https://discord.gg/keeperhub
Docs: https://docs.keeperhub.com/
About KeeperHub
KeeperHub is the execution and reliability layer for AI agents operating onchain.

Agents can think, KeeperHub lets them act. We do not replace agent frameworks or compete with them. We are the infrastructure they plug into when they need to actually transact onchain with guarantees.

This hackathon is an invitation to build on that last mile, ship an agent that executes onchain.