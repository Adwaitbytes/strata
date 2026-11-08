// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ConfigureSeason} from "../script/ConfigureSeason.s.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {IStrataArena} from "../src/interfaces/IStrataArena.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract ConfigureSeasonScriptTest is Test {
    ConfigureSeason internal script;
    StrataArena internal arena;
    uint64 internal constant T0 = 1_800_000_000;
    string internal constant FIXTURE = "test/fixtures/markets.json";

    function setUp() public {
        vm.warp(T0);
        script = new ConfigureSeason();
        // vm.startBroadcast() with no key sends as tx.origin in tests (the --sender in real runs).
        arena = new StrataArena(tx.origin, makeAddr("attestor"), address(new MockIdentityRegistry()));
    }

    function test_loadMarkets_keepsOnlyArenaEnabled() public view {
        ConfigureSeason.Market[] memory m = script.loadMarkets(vm.readFile(FIXTURE));
        assertEq(m.length, 2);
        assertEq(m[0].marketId, bytes32(uint256(0xa1)));
        assertEq(m[0].symbol, "AAA/USDC PERP");
        assertEq(m[0].maxSpreadBps, 50);
        assertEq(m[0].minDepthUsd, 100);
        assertEq(m[1].marketId, bytes32(uint256(0xc3)));
        assertEq(m[1].minDepthUsd, 5000);
    }

    function test_configure_startsSeasonAndSetsMarkets() public {
        ConfigureSeason.Market[] memory m = script.loadMarkets(vm.readFile(FIXTURE));
        uint64 season = script.configure(arena, T0, T0 + 30 days, 3600, m);
        assertEq(season, 1);
        (uint64 start, uint64 end, uint32 epochSeconds, bool active) = arena.seasons(1);
        assertEq(start, T0);
        assertEq(end, T0 + 30 days);
        assertEq(epochSeconds, 3600);
        assertTrue(active);
        IStrataArena.MarketCfg memory c = arena.getMarket(bytes32(uint256(0xc3)));
        assertTrue(c.enabled);
        assertEq(c.maxSpreadBps, 25);
        assertEq(c.symbol, "CCC/USDC PERP");
        assertFalse(arena.getMarket(bytes32(uint256(0xb2))).enabled);
    }

    function test_configure_keepsActiveSeason() public {
        ConfigureSeason.Market[] memory m = script.loadMarkets(vm.readFile(FIXTURE));
        script.configure(arena, T0, T0 + 30 days, 3600, m);
        uint64 season = script.configure(arena, T0, T0 + 60 days, 60, m);
        assertEq(season, 1, "does not restart an active season");
        (, uint64 end,,) = arena.seasons(1);
        assertEq(end, T0 + 30 days);
    }

    function test_configure_revertsOnOversizedSpread() public {
        string memory json =
            '[{"marketId":"0x00000000000000000000000000000000000000000000000000000000000000d4","ticker":"D","arenaEnabled":true,"maxSpreadBps":70000,"minDepthUsd":1}]';
        vm.expectRevert(abi.encodeWithSelector(ConfigureSeason.ValueTooLarge.selector, "maxSpreadBps"));
        script.loadMarkets(json);
    }

    function test_configure_revertsOnOversizedDepth() public {
        string memory json =
            '[{"marketId":"0x00000000000000000000000000000000000000000000000000000000000000d4","ticker":"D","arenaEnabled":true,"maxSpreadBps":1,"minDepthUsd":5000000000}]';
        vm.expectRevert(abi.encodeWithSelector(ConfigureSeason.ValueTooLarge.selector, "minDepthUsd"));
        script.loadMarkets(json);
    }

    function test_run_readsEnv() public {
        vm.setEnv("ARENA", vm.toString(address(arena)));
        vm.setEnv("SEASON_END", vm.toString(uint256(T0 + 10 days)));
        vm.setEnv("MARKETS_JSON", FIXTURE);
        uint64 season = script.run();
        assertEq(season, 1);
        (uint64 start,, uint32 epochSeconds,) = arena.seasons(1);
        assertEq(start, T0, "SEASON_START defaults to now");
        assertEq(epochSeconds, 3600, "EPOCH_SECONDS defaults to 1 hour");
        assertTrue(arena.getMarket(bytes32(uint256(0xa1))).enabled);
    }
}
