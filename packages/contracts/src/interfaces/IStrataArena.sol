// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IStrataArena
/// @notice Season registry, agent enrollment and market whitelist for the STRATA arena (PRD 8.1).
/// @dev Holds no funds. Agent identity is an ERC-8004 identity token; ownership is checked via the
///      registry's ERC-721 `ownerOf`. The registry address is a constructor argument and must be
///      verified from Injective docs before deployment (PRD 4.5).
interface IStrataArena {
    enum Status {
        None,
        Active,
        Withdrawn,
        Suspended
    }

    struct Season {
        uint64 startTime;
        uint64 endTime;
        uint32 epochSeconds;
        bool active;
    }

    struct MarketCfg {
        bool enabled;
        uint16 maxSpreadBps;
        uint32 minDepthUsd;
        string symbol;
    }

    struct Agent {
        address operator;
        uint256 erc8004Id;
        bytes32 subaccountId;
        string metadataURI;
        uint64 enrolledAt;
        Status status;
    }

    event AgentEnrolled(uint256 indexed agentId, address indexed operator, uint256 indexed erc8004Id, bytes32 subaccountId, uint64 season, string metadataURI);
    event AgentUpdated(uint256 indexed agentId, string metadataURI);
    event AgentWithdrawn(uint256 indexed agentId);
    event AgentSuspended(uint256 indexed agentId, string reason);
    event MarketSet(bytes32 indexed marketId, bool enabled, uint16 maxSpreadBps, uint32 minDepthUsd, string symbol);
    event SeasonStarted(uint64 indexed season, uint64 startTime, uint64 endTime, uint32 epochSeconds);
    event SeasonEnded(uint64 indexed season, uint64 endedAt);
    event AttestorChanged(address indexed previousAttestor, address indexed newAttestor);
    event AgentCapChanged(uint256 previousCap, uint256 newCap);

    error NotIdentityOwner();
    error AlreadyEnrolled();
    error NoActiveSeason();
    error SeasonStillActive();
    error InvalidSeason();
    error NotOperator();
    error AgentNotActive();
    error ZeroAddress();
    error InvalidMarket();
    error AgentCapReached();
    error EmptyReason();

    /// @notice Enroll the caller's ERC-8004 identity as an arena agent for the current season.
    function enroll(uint256 erc8004Id, bytes32 subaccountId, string calldata metadataURI) external returns (uint256 agentId);
    /// @notice Update the metadata URI of an agent. Operator only.
    function updateMetadata(uint256 agentId, string calldata uri) external;
    /// @notice Withdraw an agent from the arena. Operator only. Irreversible for this agent ID.
    function withdrawAgent(uint256 agentId) external;
    /// @notice Configure a market. Owner only.
    function setMarket(bytes32 marketId, MarketCfg calldata cfg) external;
    /// @notice Start a new season. Owner only. The previous season must be ended.
    function startSeason(uint64 startTime, uint64 endTime, uint32 epochSeconds) external returns (uint64 season);
    /// @notice End the current season. Owner only.
    function endSeason() external;
    /// @notice Suspend an agent for proven abuse. Owner only. Reason is emitted publicly.
    function suspendAgent(uint256 agentId, string calldata reason) external;
    /// @notice Change the attestor address. Owner only.
    function setAttestor(address newAttestor) external;

    function attestor() external view returns (address);
    function currentSeason() external view returns (uint64);
    function identityRegistry() external view returns (address);
    function seasons(uint64 season) external view returns (uint64 startTime, uint64 endTime, uint32 epochSeconds, bool active);
    function getMarket(bytes32 marketId) external view returns (MarketCfg memory);
    function getAgent(uint256 agentId) external view returns (Agent memory);
    function agentIdOf(address operator) external view returns (uint256);
    function agentCount() external view returns (uint256);
}
