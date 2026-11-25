// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FundChain - all-or-nothing decentralized crowdfunding
/// @notice Many campaigns live in one contract. Funds are held by the contract
///         until the deadline: the creator can withdraw only if the goal was met,
///         otherwise every contributor can pull their money back.
contract FundChain {
    // ───────────── Types ─────────────
    enum Status { Active, Successful, Failed, Withdrawn }

    struct Campaign {
        address creator;
        string title;
        string description;
        uint256 goal;        // in wei
        uint256 deadline;    // unix timestamp
        uint256 totalRaised; // in wei
        bool withdrawn;
    }

    // ───────────── Storage ─────────────
    Campaign[] private campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => address[]) private contributors;

    uint256 private _lock = 1; // reentrancy guard

    // ───────────── Events ─────────────
    event CampaignCreated(uint256 indexed id, address indexed creator, string title, uint256 goal, uint256 deadline);
    event Contributed(uint256 indexed id, address indexed contributor, uint256 amount, uint256 totalRaised);
    event Withdrawn(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed contributor, uint256 amount);

    // ───────────── Errors ─────────────
    error InvalidCampaign();
    error InvalidInput();
    error CampaignEnded();
    error CampaignNotEnded();
    error GoalNotReached();
    error GoalReached();
    error NotCreator();
    error AlreadyWithdrawn();
    error NothingToRefund();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier exists(uint256 id) {
        if (id >= campaigns.length) revert InvalidCampaign();
        _;
    }

    // ───────────── Write functions ─────────────

    function createCampaign(
        string calldata title,
        string calldata description,
        uint256 goal,
        uint256 durationSeconds
    ) external returns (uint256 id) {
        if (bytes(title).length == 0 || goal == 0 || durationSeconds == 0) revert InvalidInput();

        id = campaigns.length;
        uint256 deadline = block.timestamp + durationSeconds;
        campaigns.push(Campaign(msg.sender, title, description, goal, deadline, 0, false));

        emit CampaignCreated(id, msg.sender, title, goal, deadline);
    }

    function contribute(uint256 id) external payable exists(id) {
        Campaign storage c = campaigns[id];
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (msg.value == 0) revert InvalidInput();

        if (contributions[id][msg.sender] == 0) contributors[id].push(msg.sender);
        contributions[id][msg.sender] += msg.value;
        c.totalRaised += msg.value;

        emit Contributed(id, msg.sender, msg.value, c.totalRaised);
    }

    /// @notice Creator collects the funds once the deadline has passed and the goal was met.
    function withdraw(uint256 id) external exists(id) nonReentrant {
        Campaign storage c = campaigns[id];
        if (msg.sender != c.creator) revert NotCreator();
        if (block.timestamp < c.deadline) revert CampaignNotEnded();
        if (c.totalRaised < c.goal) revert GoalNotReached();
        if (c.withdrawn) revert AlreadyWithdrawn();

        c.withdrawn = true;
        uint256 amount = c.totalRaised;

        (bool ok, ) = payable(c.creator).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(id, c.creator, amount);
    }

    /// @notice Contributor reclaims their money if the deadline passed and the goal was missed.
    function refund(uint256 id) external exists(id) nonReentrant {
        Campaign storage c = campaigns[id];
        if (block.timestamp < c.deadline) revert CampaignNotEnded();
        if (c.totalRaised >= c.goal) revert GoalReached();

        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        contributions[id][msg.sender] = 0; // effects before interaction

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Refunded(id, msg.sender, amount);
    }

    // ───────────── Read functions ─────────────

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaign(uint256 id) external view exists(id) returns (Campaign memory) {
        return campaigns[id];
    }

    function getContributors(uint256 id) external view exists(id) returns (address[] memory) {
        return contributors[id];
    }

    function status(uint256 id) public view exists(id) returns (Status) {
        Campaign storage c = campaigns[id];
        if (c.withdrawn) return Status.Withdrawn;
        if (block.timestamp < c.deadline) return Status.Active;
        return c.totalRaised >= c.goal ? Status.Successful : Status.Failed;
    }
}
