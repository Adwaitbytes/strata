// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IStrataArena} from "./interfaces/IStrataArena.sol";

/// @title StrataArena
/// @notice Season registry, agent enrollment and market whitelist for the STRATA arena (PRD 8.1).
/// @dev Immutable (no proxy) and non-custodial: no payable function, no receive or fallback, so the
///      contract can never hold native funds. Agent IDs start at 1; `agentIdOf(x) == 0` means none.
contract StrataArena is IStrataArena, Ownable2Step {
    /// @notice Upper bound on metadata URI length in bytes.
    uint256 public constant MAX_URI_LENGTH = 512;
    /// @notice Upper bound on a market symbol length in bytes.
    uint256 public constant MAX_SYMBOL_LENGTH = 32;
    /// @dev 10_000 bps = 100%. A spread limit above that is meaningless.
    uint16 private constant MAX_SPREAD_BPS = 1e4;

    /// @inheritdoc IStrataArena
    address public immutable identityRegistry;
    /// @inheritdoc IStrataArena
    address public attestor;
    /// @inheritdoc IStrataArena
    uint64 public currentSeason;
    /// @inheritdoc IStrataArena
    uint256 public agentCount;
    /// @notice Maximum agents enrolled per season. Zero means unlimited.
    uint256 public agentCap;
    /// @notice Maximum enrollments per operator per season. Defaults to one (PRD 8.1).
    uint256 public operatorCap = 1;

    /// @inheritdoc IStrataArena
    mapping(uint64 season => Season) public seasons;
    /// @notice Most recent agent ID enrolled by an operator.
    mapping(address operator => uint256 agentId) public agentIdOf;
    /// @notice Season an agent ID was enrolled in.
    mapping(uint256 agentId => uint64 season) public agentSeason;
    /// @notice Number of agents enrolled in a season. Withdrawn and suspended agents still count.
    mapping(uint64 season => uint256 count) public seasonAgentCount;
    /// @notice Number of enrollments by an operator in a season. Withdrawing does not free a slot.
    mapping(uint64 season => mapping(address operator => uint256 count)) public operatorEnrollments;
    /// @notice Whether an ERC-8004 identity is already enrolled in a season.
    mapping(uint64 season => mapping(uint256 erc8004Id => bool enrolled)) public identityEnrolled;

    mapping(bytes32 marketId => MarketCfg) private _markets;
    mapping(uint256 agentId => Agent) private _agents;

    /// @notice Emitted when the per-operator enrollment cap changes.
    event OperatorCapChanged(uint256 previousCap, uint256 newCap);

    error RenounceDisabled();
    error ZeroSubaccount();
    error InvalidMetadataURI();
    error InvalidOperatorCap();

    /// @param owner_ Contract owner. Must be a hardware wallet or Safe in production (PRD 8.4).
    /// @param attestor_ Address allowed to post score epochs to ScoreAttestor.
    /// @param identityRegistry_ ERC-8004 identity registry (ERC-721 compatible).
    constructor(address owner_, address attestor_, address identityRegistry_) Ownable(owner_) {
        if (attestor_ == address(0) || identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = identityRegistry_;
        attestor = attestor_;
        emit AttestorChanged(address(0), attestor_);
    }

    // ------------------------------------------------------------------ operator actions

    /// @inheritdoc IStrataArena
    /// @dev Reverts with NotIdentityOwner if the registry call reverts or the caller is not the token owner.
    function enroll(uint256 erc8004Id, bytes32 subaccountId, string calldata metadataURI)
        external
        returns (uint256 agentId)
    {
        uint64 season = currentSeason;
        Season storage s = seasons[season];
        if (!s.active || block.timestamp >= s.endTime) revert NoActiveSeason();
        if (subaccountId == bytes32(0)) revert ZeroSubaccount();
        _checkURI(metadataURI);
        if (identityEnrolled[season][erc8004Id]) revert AlreadyEnrolled();
        if (operatorEnrollments[season][msg.sender] >= operatorCap) revert AlreadyEnrolled();
        uint256 cap = agentCap;
        if (cap != 0 && seasonAgentCount[season] >= cap) revert AgentCapReached();

        // ownerOf is `view`, so this compiles to STATICCALL: the registry cannot reenter or change state.
        // aderyn-fp-next-line(reentrancy-state-change)
        try IERC721(identityRegistry).ownerOf(erc8004Id) returns (address holder) {
            if (holder != msg.sender) revert NotIdentityOwner();
        } catch {
            revert NotIdentityOwner();
        }

        agentId = ++agentCount;
        identityEnrolled[season][erc8004Id] = true;
        ++operatorEnrollments[season][msg.sender];
        ++seasonAgentCount[season];
        agentIdOf[msg.sender] = agentId;
        agentSeason[agentId] = season;
        _agents[agentId] = Agent({
            operator: msg.sender,
            erc8004Id: erc8004Id,
            subaccountId: subaccountId,
            metadataURI: metadataURI,
            // forge-lint: disable-next-line(unsafe-typecast)
            enrolledAt: uint64(block.timestamp), // uint64 seconds lasts ~5.8e11 years
            status: Status.Active
        });
        emit AgentEnrolled(agentId, msg.sender, erc8004Id, subaccountId, season, metadataURI);
    }

    /// @inheritdoc IStrataArena
    function updateMetadata(uint256 agentId, string calldata uri) external {
        Agent storage a = _activeAgentOf(agentId);
        _checkURI(uri);
        a.metadataURI = uri;
        emit AgentUpdated(agentId, uri);
    }

    /// @inheritdoc IStrataArena
    function withdrawAgent(uint256 agentId) external {
        Agent storage a = _activeAgentOf(agentId);
        a.status = Status.Withdrawn;
        emit AgentWithdrawn(agentId);
    }

    // ------------------------------------------------------------------ owner actions

    /// @inheritdoc IStrataArena
    function setMarket(bytes32 marketId, MarketCfg calldata cfg) external onlyOwner {
        uint256 symbolLength = bytes(cfg.symbol).length;
        if (marketId == bytes32(0) || symbolLength == 0 || symbolLength > MAX_SYMBOL_LENGTH) revert InvalidMarket();
        if (cfg.enabled && (cfg.maxSpreadBps == 0 || cfg.maxSpreadBps > MAX_SPREAD_BPS)) revert InvalidMarket();
        _markets[marketId] = cfg;
        emit MarketSet(marketId, cfg.enabled, cfg.maxSpreadBps, cfg.minDepthUsd, cfg.symbol);
    }

    /// @inheritdoc IStrataArena
    function startSeason(uint64 startTime, uint64 endTime, uint32 epochSeconds)
        external
        onlyOwner
        returns (uint64 season)
    {
        if (seasons[currentSeason].active) revert SeasonStillActive();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidSeason();
        if (epochSeconds == 0 || epochSeconds > endTime - startTime) revert InvalidSeason();
        season = ++currentSeason;
        seasons[season] = Season({startTime: startTime, endTime: endTime, epochSeconds: epochSeconds, active: true});
        emit SeasonStarted(season, startTime, endTime, epochSeconds);
    }

    /// @inheritdoc IStrataArena
    /// @dev Ending early clamps `endTime` to the current block time so readers see the real end.
    function endSeason() external onlyOwner {
        uint64 season = currentSeason;
        Season storage s = seasons[season];
        if (!s.active) revert NoActiveSeason();
        s.active = false;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp); // uint64 seconds lasts ~5.8e11 years
        if (nowTs < s.endTime) s.endTime = nowTs;
        emit SeasonEnded(season, nowTs);
    }

    /// @inheritdoc IStrataArena
    /// @dev Withdrawn agents can still be suspended so post-hoc abuse findings are recorded onchain.
    function suspendAgent(uint256 agentId, string calldata reason) external onlyOwner {
        if (bytes(reason).length == 0) revert EmptyReason();
        Agent storage a = _agents[agentId];
        if (a.status == Status.None || a.status == Status.Suspended) revert AgentNotActive();
        a.status = Status.Suspended;
        emit AgentSuspended(agentId, reason);
    }

    /// @inheritdoc IStrataArena
    function setAttestor(address newAttestor) external onlyOwner {
        if (newAttestor == address(0)) revert ZeroAddress();
        emit AttestorChanged(attestor, newAttestor);
        attestor = newAttestor;
    }

    /// @notice Set the maximum number of agents per season. Zero means unlimited. Owner only.
    /// @param newCap New per-season cap.
    function setAgentCap(uint256 newCap) external onlyOwner {
        emit AgentCapChanged(agentCap, newCap);
        agentCap = newCap;
    }

    /// @notice Set the maximum number of enrollments per operator per season. Owner only.
    /// @param newCap New per-operator cap, at least one.
    function setOperatorCap(uint256 newCap) external onlyOwner {
        if (newCap == 0) revert InvalidOperatorCap();
        emit OperatorCapChanged(operatorCap, newCap);
        operatorCap = newCap;
    }

    /// @notice Disabled: an ownerless arena could never end a season or change the attestor.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IStrataArena
    function getMarket(bytes32 marketId) external view returns (MarketCfg memory) {
        return _markets[marketId];
    }

    /// @inheritdoc IStrataArena
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    // ------------------------------------------------------------------ internal

    function _activeAgentOf(uint256 agentId) private view returns (Agent storage a) {
        a = _agents[agentId];
        if (a.operator != msg.sender) revert NotOperator();
        if (a.status != Status.Active) revert AgentNotActive();
    }

    function _checkURI(string calldata uri) private pure {
        uint256 length = bytes(uri).length;
        if (length == 0 || length > MAX_URI_LENGTH) revert InvalidMetadataURI();
    }
}
