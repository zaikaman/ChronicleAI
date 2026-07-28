// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ChronicleRegistry
 * @notice On-chain proof-of-publication and revenue parking for ChronicleAI.
 *
 * IDEA-aligned methods:
 *   - `publishAlert(contentHash, sourceEventHash, contentUri)`
 *   - `publishDigest(contentHash, sourceEventRoot, contentUri)`
 *   - `createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt)` — uint64 window
 *   - `publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri)`
 *   - `recordPayout(payoutPeriodHash, recipient, amount, reasonHash)`
 *   - `publishTradeTicket(ticketHash, signalHash, intentHash, contentUri)` — desk execution proof
 *   - `recordCapitalMove(moveId, from, to, amount, reasonHash)` — desk capital audit
 *   - `reportType` — Alert / Digest / SponsoredReport / PremiumReceipt / TradeTicket per content hash
 *
 * Loop 4 (sponsored watch): `publishSponsoredReport` anchors the final report
 * hash together with a Merkle-style `sourceEventRoot` of monitored events.
 *
 * Desk (Chronicle Desk): trade tickets and capital moves are published by the
 * owner or an operator (KeeperHub desk wallet granted via `setOperator`).
 */
contract ChronicleRegistry {
    // ── Types ──────────────────────────────────────────────
    /**
     * @notice Classification of a published content hash (IDEA reportType).
     * Alert = 0, Digest = 1, SponsoredReport = 2, PremiumReceipt = 3, TradeTicket = 4.
     */
    enum ReportType {
        Alert,
        Digest,
        SponsoredReport,
        PremiumReceipt,
        TradeTicket
    }

    struct WatchCampaign {
        address targetContract;
        bytes32 watchSpecHash;
        uint64 startsAt;
        uint64 endsAt;
        uint256 createdAt;
        string contentUri; // empty until report is published
        bytes32 reportHash; // zero until report is published
        bytes32 sourceEventRoot; // zero until report is published
    }

    // ── State ──────────────────────────────────────────────
    address public owner;

    /// @notice KeeperHub desk wallet (and other operators) allowed to publish.
    /// Deploy owner can grant operators so the deploy EOA is not on the hot path.
    mapping(address => bool) public operators;

    // contentHash => timestamp
    mapping(bytes32 => uint256) public alerts;
    // contentHash => source event / tx bundle hash (IDEA sourceEventHash)
    mapping(bytes32 => bytes32) public alertSourceEventHashes;

    // contentHash => timestamp
    mapping(bytes32 => uint256) public digests;
    // contentHash => Merkle / commitment root of digest source events
    mapping(bytes32 => bytes32) public digestSourceEventRoots;

    // contentHash => report type for any publication receipt
    mapping(bytes32 => ReportType) public reportTypes;
    // contentHash => whether a reportType has been recorded (enum default is Alert)
    mapping(bytes32 => bool) public hasReportType;

    // contentHash => timestamp for premium intelligence receipts
    mapping(bytes32 => uint256) public premiumReceipts;
    // contentHash => source event hash for premium receipts
    mapping(bytes32 => bytes32) public premiumSourceEventHashes;

    // watchId => WatchCampaign
    mapping(uint256 => WatchCampaign) public sponsoredWatches;
    uint256 public nextWatchId;

    // payoutBatchHash => timestamp
    mapping(bytes32 => uint256) public payouts;

    // ticketHash => timestamp (desk execution tickets)
    mapping(bytes32 => uint256) public tradeTickets;
    // ticketHash => signal commitment
    mapping(bytes32 => bytes32) public tradeTicketSignalHashes;
    // ticketHash => intent commitment
    mapping(bytes32 => bytes32) public tradeTicketIntentHashes;

    // moveId => timestamp (desk capital audit: fund / sweep / emergency return)
    mapping(bytes32 => uint256) public capitalMoves;

    // ── Events ─────────────────────────────────────────────
    event AlertPublished(
        bytes32 indexed contentHash,
        bytes32 sourceEventHash,
        string contentUri,
        ReportType reportType,
        uint256 timestamp
    );
    event DigestPublished(
        bytes32 indexed contentHash,
        bytes32 sourceEventRoot,
        string contentUri,
        ReportType reportType,
        uint256 timestamp
    );
    event SponsoredWatchCreated(
        uint256 indexed watchId,
        address indexed targetContract,
        bytes32 watchSpecHash,
        uint64 startsAt,
        uint64 endsAt
    );
    event SponsoredReportPublished(
        uint256 indexed watchId,
        bytes32 reportHash,
        bytes32 sourceEventRoot,
        string contentUri,
        ReportType reportType
    );
    event PremiumReceiptPublished(
        bytes32 indexed contentHash,
        bytes32 sourceEventHash,
        string contentUri,
        ReportType reportType,
        uint256 timestamp
    );
    event PayoutRecorded(
        bytes32 indexed payoutPeriodHash,
        address indexed recipient,
        uint256 amount,
        bytes32 reasonHash
    );
    event TradeTicketPublished(
        bytes32 indexed ticketHash,
        bytes32 signalHash,
        bytes32 intentHash,
        string contentUri,
        ReportType reportType,
        uint256 timestamp
    );
    event CapitalMoveRecorded(
        bytes32 indexed moveId,
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 reasonHash,
        uint256 timestamp
    );
    event OperatorUpdated(address indexed account, bool allowed);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ChronicleRegistry: caller is not the owner");
        _;
    }

    modifier onlyOwnerOrOperator() {
        require(
            msg.sender == owner || operators[msg.sender],
            "ChronicleRegistry: caller is not owner or operator"
        );
        _;
    }

    // ── Constructor ────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ── Ownership ──────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ChronicleRegistry: new owner is the zero address");
        owner = newOwner;
    }

    /// @notice Grant or revoke operator rights (KeeperHub desk wallet after deploy).
    function setOperator(address account, bool allowed) external onlyOwner {
        require(account != address(0), "ChronicleRegistry: operator is the zero address");
        operators[account] = allowed;
        emit OperatorUpdated(account, allowed);
    }

    // ── Publish Alert ──────────────────────────────────────
    /**
     * @notice Stores a public alert proof-of-publication (IDEA Loop 1).
     * @param contentHash Hash of the generated alert body
     * @param sourceEventHash Hash of the source transaction/event bundle
     * @param contentUri Resolvable HTTPS (or storage) URI for the published alert
     */
    function publishAlert(
        bytes32 contentHash,
        bytes32 sourceEventHash,
        string calldata contentUri
    ) external onlyOwnerOrOperator {
        require(alerts[contentHash] == 0, "ChronicleRegistry: alert already published");
        require(contentHash != bytes32(0), "ChronicleRegistry: content hash required");
        require(bytes(contentUri).length > 0, "ChronicleRegistry: content URI required");

        alerts[contentHash] = block.timestamp;
        alertSourceEventHashes[contentHash] = sourceEventHash;
        _setReportType(contentHash, ReportType.Alert);

        emit AlertPublished(
            contentHash,
            sourceEventHash,
            contentUri,
            ReportType.Alert,
            block.timestamp
        );
    }

    // ── Publish Digest ─────────────────────────────────────
    /**
     * @notice Stores a daily digest proof-of-publication (IDEA Loop 2).
     * @param contentHash Hash of the generated digest body
     * @param sourceEventRoot Merkle / commitment root of source events
     * @param contentUri Resolvable HTTPS (or storage) URI for the published digest
     */
    function publishDigest(
        bytes32 contentHash,
        bytes32 sourceEventRoot,
        string calldata contentUri
    ) external onlyOwnerOrOperator {
        require(digests[contentHash] == 0, "ChronicleRegistry: digest already published");
        require(contentHash != bytes32(0), "ChronicleRegistry: content hash required");
        require(bytes(contentUri).length > 0, "ChronicleRegistry: content URI required");

        digests[contentHash] = block.timestamp;
        digestSourceEventRoots[contentHash] = sourceEventRoot;
        _setReportType(contentHash, ReportType.Digest);

        emit DigestPublished(
            contentHash,
            sourceEventRoot,
            contentUri,
            ReportType.Digest,
            block.timestamp
        );
    }

    // ── Create Sponsored Watch ─────────────────────────────
    /**
     * @notice Records that the agent accepted a paid monitoring campaign.
     * @param targetContract Contract address being monitored
     * @param watchSpecHash Hash of the watch specification
     * @param startsAt Campaign start (unix seconds, uint64 per IDEA)
     * @param endsAt Campaign end (unix seconds, uint64 per IDEA)
     */
    function createSponsoredWatch(
        address targetContract,
        bytes32 watchSpecHash,
        uint64 startsAt,
        uint64 endsAt
    ) external onlyOwnerOrOperator returns (uint256 watchId) {
        require(targetContract != address(0), "ChronicleRegistry: target required");
        require(startsAt < endsAt, "ChronicleRegistry: watch must start before it ends");

        watchId = nextWatchId;
        sponsoredWatches[watchId] = WatchCampaign({
            targetContract: targetContract,
            watchSpecHash: watchSpecHash,
            startsAt: startsAt,
            endsAt: endsAt,
            createdAt: block.timestamp,
            contentUri: "",
            reportHash: bytes32(0),
            sourceEventRoot: bytes32(0)
        });
        nextWatchId++;

        emit SponsoredWatchCreated(watchId, targetContract, watchSpecHash, startsAt, endsAt);
    }

    // ── Publish Sponsored Report ──────────────────────────
    /**
     * @notice Anchors the final sponsored-watch report with its source-event root.
     * @param watchId On-chain campaign id returned by createSponsoredWatch
     * @param reportHash Hash of the generated report body
     * @param sourceEventRoot Merkle / commitment root of source events observed in-window
     * @param contentUri Resolvable HTTPS content URI for the published report
     */
    function publishSponsoredReport(
        uint256 watchId,
        bytes32 reportHash,
        bytes32 sourceEventRoot,
        string calldata contentUri
    ) external onlyOwnerOrOperator {
        require(watchId < nextWatchId, "ChronicleRegistry: watch does not exist");
        WatchCampaign storage campaign = sponsoredWatches[watchId];
        require(campaign.targetContract != address(0), "ChronicleRegistry: watch does not exist");
        require(bytes(campaign.contentUri).length == 0, "ChronicleRegistry: report already published");
        require(reportHash != bytes32(0), "ChronicleRegistry: report hash required");
        require(bytes(contentUri).length > 0, "ChronicleRegistry: content URI required");

        campaign.contentUri = contentUri;
        campaign.reportHash = reportHash;
        campaign.sourceEventRoot = sourceEventRoot;
        _setReportType(reportHash, ReportType.SponsoredReport);

        emit SponsoredReportPublished(
            watchId,
            reportHash,
            sourceEventRoot,
            contentUri,
            ReportType.SponsoredReport
        );
    }

    // ── Publish Premium Receipt ───────────────────────────
    /**
     * @notice Stores a premium intelligence receipt proof-of-publication.
     * @param contentHash Hash of the paid report body
     * @param sourceEventHash Hash of the source transaction/event bundle
     * @param contentUri Resolvable URI for the premium content
     */
    function publishPremiumReceipt(
        bytes32 contentHash,
        bytes32 sourceEventHash,
        string calldata contentUri
    ) external onlyOwnerOrOperator {
        require(premiumReceipts[contentHash] == 0, "ChronicleRegistry: premium receipt already published");
        require(contentHash != bytes32(0), "ChronicleRegistry: content hash required");
        require(bytes(contentUri).length > 0, "ChronicleRegistry: content URI required");

        premiumReceipts[contentHash] = block.timestamp;
        premiumSourceEventHashes[contentHash] = sourceEventHash;
        _setReportType(contentHash, ReportType.PremiumReceipt);

        emit PremiumReceiptPublished(
            contentHash,
            sourceEventHash,
            contentUri,
            ReportType.PremiumReceipt,
            block.timestamp
        );
    }

    // ── Record Payout ──────────────────────────────────────
    function recordPayout(
        bytes32 payoutPeriodHash,
        address recipient,
        uint256 amount,
        bytes32 reasonHash
    ) external onlyOwnerOrOperator {
        require(payouts[payoutPeriodHash] == 0, "ChronicleRegistry: payout for this period already recorded");
        payouts[payoutPeriodHash] = block.timestamp;
        emit PayoutRecorded(payoutPeriodHash, recipient, amount, reasonHash);
    }

    // ── Publish Trade Ticket ───────────────────────────────
    /**
     * @notice Anchor a desk execution ticket (Chronicle Desk proof-of-trade).
     * @param ticketHash keccak of canonical ticket JSON (signal, intent, legs, policy)
     * @param signalHash commitment to source signal bundle
     * @param intentHash commitment to TradeIntent
     * @param contentUri public ticket URL on Chronicle web (`/desk/tickets/:id`)
     */
    function publishTradeTicket(
        bytes32 ticketHash,
        bytes32 signalHash,
        bytes32 intentHash,
        string calldata contentUri
    ) external onlyOwnerOrOperator {
        require(tradeTickets[ticketHash] == 0, "ChronicleRegistry: trade ticket already published");
        require(ticketHash != bytes32(0), "ChronicleRegistry: ticket hash required");
        require(bytes(contentUri).length > 0, "ChronicleRegistry: content URI required");

        tradeTickets[ticketHash] = block.timestamp;
        tradeTicketSignalHashes[ticketHash] = signalHash;
        tradeTicketIntentHashes[ticketHash] = intentHash;
        _setReportType(ticketHash, ReportType.TradeTicket);

        emit TradeTicketPublished(
            ticketHash,
            signalHash,
            intentHash,
            contentUri,
            ReportType.TradeTicket,
            block.timestamp
        );
    }

    // ── Record Capital Move ────────────────────────────────
    /**
     * @notice Record a desk capital transfer for on-chain audit (top-up / sweep / emergency).
     * @param moveId Unique move id commitment (e.g. keccak of desk_capital_moves row)
     * @param from Source address (treasury or desk)
     * @param to Destination address (desk or treasury)
     * @param amount USDC base units (6 decimals)
     * @param reasonHash Commitment to reason (desk_fund | desk_sweep | desk_emergency_return)
     */
    function recordCapitalMove(
        bytes32 moveId,
        address from,
        address to,
        uint256 amount,
        bytes32 reasonHash
    ) external onlyOwnerOrOperator {
        require(capitalMoves[moveId] == 0, "ChronicleRegistry: capital move already recorded");
        require(moveId != bytes32(0), "ChronicleRegistry: move id required");
        require(from != address(0), "ChronicleRegistry: from required");
        require(to != address(0), "ChronicleRegistry: to required");
        require(amount > 0, "ChronicleRegistry: amount required");

        capitalMoves[moveId] = block.timestamp;

        emit CapitalMoveRecorded(moveId, from, to, amount, reasonHash, block.timestamp);
    }

    // ── View helpers ───────────────────────────────────────
    function getAlertTimestamp(bytes32 contentHash) external view returns (uint256) {
        return alerts[contentHash];
    }

    function getAlertSourceEventHash(bytes32 contentHash) external view returns (bytes32) {
        return alertSourceEventHashes[contentHash];
    }

    function getDigestTimestamp(bytes32 contentHash) external view returns (uint256) {
        return digests[contentHash];
    }

    function getDigestSourceEventRoot(bytes32 contentHash) external view returns (bytes32) {
        return digestSourceEventRoots[contentHash];
    }

    function getReportType(bytes32 contentHash) external view returns (ReportType) {
        require(hasReportType[contentHash], "ChronicleRegistry: unknown content hash");
        return reportTypes[contentHash];
    }

    function getWatch(uint256 watchId) external view returns (WatchCampaign memory) {
        require(watchId < nextWatchId, "ChronicleRegistry: watch does not exist");
        return sponsoredWatches[watchId];
    }

    function getPayoutTimestamp(bytes32 payoutPeriodHash) external view returns (uint256) {
        return payouts[payoutPeriodHash];
    }

    function getPremiumReceiptTimestamp(bytes32 contentHash) external view returns (uint256) {
        return premiumReceipts[contentHash];
    }

    function getTradeTicketTimestamp(bytes32 ticketHash) external view returns (uint256) {
        return tradeTickets[ticketHash];
    }

    function getTradeTicketSignalHash(bytes32 ticketHash) external view returns (bytes32) {
        return tradeTicketSignalHashes[ticketHash];
    }

    function getTradeTicketIntentHash(bytes32 ticketHash) external view returns (bytes32) {
        return tradeTicketIntentHashes[ticketHash];
    }

    function getCapitalMoveTimestamp(bytes32 moveId) external view returns (uint256) {
        return capitalMoves[moveId];
    }

    // ── Internals ──────────────────────────────────────────
    function _setReportType(bytes32 contentHash, ReportType reportType) private {
        reportTypes[contentHash] = reportType;
        hasReportType[contentHash] = true;
    }
}
