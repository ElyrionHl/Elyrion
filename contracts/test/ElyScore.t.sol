// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ElyScore} from "../src/libraries/ElyScore.sol";

contract ElyScoreTest is Test {
    uint256 constant USD = 1e6;
    uint256 constant NOW = 1_000_000_000;

    function _inputs() internal pure returns (ElyScore.Inputs memory i) {
        i.nowTs = NOW;
    }

    function _s(ElyScore.Inputs memory i) internal pure returns (uint256) {
        return ElyScore.score(i);
    }

    function test_scoreZeroWhenDefaulted() public pure {
        ElyScore.Inputs memory i = _inputs();
        i.defaulted = true;
        i.dollarSecondsRepaid = 1000 * USD * 1 days;
        i.qualifiedRepaid = 20;
        i.lineAmount = 500 * USD;
        i.firstRepaidAt = NOW - 100 days;
        assertEq(_s(i), 0);
    }

    function test_dollarDaysCap() public pure {
        ElyScore.Inputs memory i = _inputs();
        i.dollarSecondsRepaid = 400 * USD * 1 days;
        assertEq(_s(i), 400);
        i.dollarSecondsRepaid = 10_000 * USD * 1 days;
        assertEq(_s(i), 400);
        i.dollarSecondsRepaid = 50 * USD * 1 days;
        assertEq(_s(i), 50);
    }

    function test_qualifiedCap() public pure {
        ElyScore.Inputs memory i = _inputs();
        i.qualifiedRepaid = 3;
        assertEq(_s(i), 75);
        i.qualifiedRepaid = 20;
        assertEq(_s(i), 250);
    }

    function test_backing() public pure {
        ElyScore.Inputs memory i = _inputs();
        i.lineAmount = 5 * USD;
        assertEq(_s(i), 15);
        i.lineAmount = 50 * USD;
        assertEq(_s(i), 150);
        i.lineAmount = 500 * USD;
        assertEq(_s(i), 150);
    }

    function test_ageFromFirstRepay() public pure {
        ElyScore.Inputs memory i = _inputs();
        assertEq(_s(i), 0);
        i.firstRepaidAt = NOW - 3 days;
        assertEq(_s(i), 15);
        i.firstRepaidAt = NOW - 100 days;
        assertEq(_s(i), 200);
    }

    function test_maxIs1000() public pure {
        ElyScore.Inputs memory i = _inputs();
        i.dollarSecondsRepaid = 10_000 * USD * 1 days;
        i.qualifiedRepaid = 20;
        i.lineAmount = 500 * USD;
        i.firstRepaidAt = NOW - 100 days;
        assertEq(_s(i), 1000);
    }
}
