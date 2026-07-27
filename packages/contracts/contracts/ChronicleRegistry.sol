// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ChronicleRegistry
 * @notice On-chain proof-of-publication and revenue parking for ChronicleAI.
 *
 * The contract records:
 *   - Public alerts (`publishAlert`)
 *   - Daily digests (`publishDigest`)
 *   - Sponsored watch campaigns (`createSponsoredWatch`, `publishSponsoredReport`)
 *   - Revenue payouts (`recordPayout`)
 *
 * Each record stores a content hash and emits an event so off-chain indexers
 * and the ChronicleAI dashboard can display the on-chain receipt.
 */
contract ChronicleRegistry {
    // ── State ──────────────────────────────────────────────
    address public owner;

    // alertHash => timestamp
    mapping(bytes32 => uint256) public alerts;

    // digestHash => timestamp
    mapping(bytes32 => uint256) public digests;

    // watchId => WatchCampaign
    mapping(uint256 => WatchCampaign) public sponsoredWatches;
    uint256 public nextWatchId;

    // payoutBatchHash => timestamp
    mapping(bytes32 => uint256) public payouts;

    // ── Types ──────────────────────────────────────────────
    struct WatchCampaign {
        address targetContract;
        bytes32 watchSpecHash;
        uint256 startsAt;
        uint256 endsAt;
        uint256 createdAt;
        string reportUri; // empty until report is published
    }

    // ── Events ─────────────────────────────────────────────
    event AlertPublished(bytes32 indexed alertHash, string ipfsUri, uint256 timestamp);
    event DigestPublished(bytes32 indexed digestHash, bytes32 sourceEventRoot, string ipfsUri, uint256 timestamp);
    event SponsoredWatchCreated(uint256 indexed watchId, address indexed targetContract, bytes32 watchSpecHash, uint256 startsAt, uint256 endsAt);
    event SponsoredReportPublished(uint256 indexed watchId, bytes32 reportContentHash, string reportUri);
    event PayoutRecorded(bytes32 indexed payoutPeriodHash, address indexed recipient, uint256 amount, bytes32 reasonHash);

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
    function publishAlert(bytes32 alertHash, string calldata ipfsUri) external onlyOwner {
        require(alerts[alertHash] == 0, "ChronicleRegistry: alert already published");
        alerts[alertHash] = block.timestamp;
        emit AlertPublished(alertHash, ipfsUri, block.timestamp);
    }

    // ── Publish Digest ─────────────────────────────────────
    function publishDigest(bytes32 digestHash, bytes32 sourceEventRoot, string calldata ipfsUri) external onlyOwner {
        require(digests[digestHash] == 0, "ChronicleRegistry: digest already published");
        digests[digestHash] = block.timestamp;
        emit DigestPublished(digestHash, sourceEventRoot, ipfsUri, block.timestamp);
    }

    // ── Create Sponsored Watch ─────────────────────────────
    function createSponsoredWatch(
        address targetContract,
        bytes32 watchSpecHash,
        uint256 startsAt,
        uint256 endsAt
    ) external onlyOwner returns (uint256 watchId) {
        require(startsAt < endsAt, "ChronicleRegistry: watch must start before it ends");
        watchId = nextWatchId;
        sponsoredWatches[watchId] = WatchCampaign({
            targetContract: targetContract,
            watchSpecHash: watchSpecHash,
            startsAt: startsAt,
            endsAt: endsAt,
            createdAt: block.timestamp,
            reportUri: ""
        });
        nextWatchId++;
        emit SponsoredWatchCreated(watchId, targetContract, watchSpecHash, startsAt, endsAt);
    }

    // ── Publish Sponsored Report ──────────────────────────
    function publishSponsoredReport(
        uint256 watchId,
        bytes32 reportContentHash,
        string calldata reportUri
    ) external onlyOwner {
        require(watchId < nextWatchId, "ChronicleRegistry: watch does not exist");
        WatchCampaign storage campaign = sponsoredWatches[watchId];
        require(campaign.targetContract != address(0), "ChronicleRegistry: watch does not exist");
        require(bytes(campaign.reportUri).length == 0, "ChronicleRegistry: report already published");
        campaign.reportUri = reportUri;
        emit SponsoredReportPublished(watchId, reportContentHash, reportUri);
    }

    // ── Record Payout ──────────────────────────────────────
    function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash) external onlyOwner {
        require(payouts[payoutPeriodHash] == 0, "ChronicleRegistry: payout for this period already recorded");
        payouts[payoutPeriodHash] = block.timestamp;
        emit PayoutRecorded(payoutPeriodHash, recipient, amount, reasonHash);
    }

    // ── Check Functions ────────────────────────────────────
    function getAlertTimestamp(bytes32 alertHash) external view returns (uint256) {
        return alerts[alertHash];
    }

    function getDigestTimestamp(bytes32 digestHash) external view returns (uint256) {
        return digests[digestHash];
    }

    function getWatch(uint256 watchId) external view returns (WatchCampaign memory) {
        require(watchId < nextWatchId, "ChronicleRegistry: watch does not exist");
        return sponsoredWatches[watchId];
    }

    function getPayoutTimestamp(bytes32 payoutPeriodHash) external view returns (uint256) {
        return payouts[payoutPeriodHash];
    }
}
