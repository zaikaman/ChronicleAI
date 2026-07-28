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
 *   - `reportType` — Alert / Digest / SponsoredReport / PremiumReceipt per content hash
 *
 * Loop 4 (sponsored watch): `publishSponsoredReport` anchors the final report
 * hash together with a Merkle-style `sourceEventRoot` of monitored events.
 */
contract ChronicleRegistry {
    // ── Types ──────────────────────────────────────────────
    /**
     * @notice Classification of a published content hash (IDEA reportType).
     * Alert = 0, Digest = 1, SponsoredReport = 2, PremiumReceipt = 3.
     */
    enum ReportType {
        Alert,
        Digest,
        SponsoredReport,
        PremiumReceipt
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

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ChronicleRegistry: caller is not the owner");
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
    ) external onlyOwner {
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
    ) external onlyOwner {
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
    ) external onlyOwner returns (uint256 watchId) {
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
    ) external onlyOwner {
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
    ) external onlyOwner {
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
    ) external onlyOwner {
        require(payouts[payoutPeriodHash] == 0, "ChronicleRegistry: payout for this period already recorded");
        payouts[payoutPeriodHash] = block.timestamp;
        emit PayoutRecorded(payoutPeriodHash, recipient, amount, reasonHash);
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

    // ── Internals ──────────────────────────────────────────
    function _setReportType(bytes32 contentHash, ReportType reportType) private {
        reportTypes[contentHash] = reportType;
        hasReportType[contentHash] = true;
    }
}
