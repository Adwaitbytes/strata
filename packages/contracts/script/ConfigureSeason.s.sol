// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {IStrataArena} from "../src/interfaces/IStrataArena.sol";

/// @notice Starts a season (unless one is active) and whitelists every `arenaEnabled` market from the
///         generated market list (packages/config/src/generated/markets.<network>.json, built by a live
///         indexer fetch, never hand-written). Must be broadcast by the arena owner.
/// @dev Env: ARENA, SEASON_END (unix s), optional SEASON_START (default now), EPOCH_SECONDS (default 3600),
///      MARKETS_JSON (path relative to packages/contracts, default ../config/src/generated/markets.testnet.json).
contract ConfigureSeason is Script {
    struct Market {
        bytes32 marketId;
        string symbol;
        uint16 maxSpreadBps;
        uint32 minDepthUsd;
    }

    error ValueTooLarge(string field);

    /// @notice Configure the arena named by env vars.
    function run() external returns (uint64) {
        string memory path = vm.envOr("MARKETS_JSON", string("../config/src/generated/markets.testnet.json"));
        return configure(
            StrataArena(vm.envAddress("ARENA")),
            uint64(vm.envOr("SEASON_START", block.timestamp)),
            uint64(vm.envUint("SEASON_END")),
            uint32(vm.envOr("EPOCH_SECONDS", uint256(3600))),
            loadMarkets(vm.readFile(path))
        );
    }

    /// @notice Parse the generated market list and keep only arena-enabled markets.
    function loadMarkets(string memory json) public view returns (Market[] memory markets) {
        uint256 n;
        while (vm.keyExistsJson(json, _key(n, ""))) ++n;
        Market[] memory buf = new Market[](n);
        uint256 kept;
        for (uint256 i; i < n; ++i) {
            if (!vm.parseJsonBool(json, _key(i, ".arenaEnabled"))) continue;
            uint256 spread = vm.parseJsonUint(json, _key(i, ".maxSpreadBps"));
            uint256 depth = vm.parseJsonUint(json, _key(i, ".minDepthUsd"));
            if (spread > type(uint16).max) revert ValueTooLarge("maxSpreadBps");
            if (depth > type(uint32).max) revert ValueTooLarge("minDepthUsd");
            buf[kept++] = Market({
                marketId: vm.parseJsonBytes32(json, _key(i, ".marketId")),
                symbol: vm.parseJsonString(json, _key(i, ".ticker")),
                // forge-lint: disable-next-line(unsafe-typecast)
                maxSpreadBps: uint16(spread), // bounded above
                // forge-lint: disable-next-line(unsafe-typecast)
                minDepthUsd: uint32(depth) // bounded above
            });
        }
        markets = new Market[](kept);
        for (uint256 i; i < kept; ++i) {
            markets[i] = buf[i];
        }
    }

    /// @notice Start a season if none is active, then set every market. Returns the current season.
    function configure(StrataArena arena, uint64 start, uint64 end, uint32 epochSeconds, Market[] memory markets)
        public
        returns (uint64 season)
    {
        season = arena.currentSeason();
        (,,, bool active) = arena.seasons(season);
        vm.startBroadcast();
        if (!active) season = arena.startSeason(start, end, epochSeconds);
        for (uint256 i; i < markets.length; ++i) {
            arena.setMarket(
                markets[i].marketId,
                IStrataArena.MarketCfg({
                    enabled: true,
                    maxSpreadBps: markets[i].maxSpreadBps,
                    minDepthUsd: markets[i].minDepthUsd,
                    symbol: markets[i].symbol
                })
            );
        }
        vm.stopBroadcast();
    }

    function _key(uint256 i, string memory field) private view returns (string memory) {
        return string.concat(".[", vm.toString(i), "]", field);
    }
}
