// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Pure 0-1000 credit score. Design adapted from Priors (see THIRD_PARTY_NOTICES.md).
/// USDC amounts use 6 decimals.
library ElyScore {
    struct Inputs {
        bool defaulted;
        uint256 dollarSecondsRepaid;
        uint256 qualifiedRepaid;
        uint256 lineAmount;
        uint256 firstRepaidAt;
        uint256 nowTs;
    }

    uint256 internal constant MAX_DOLLAR_DAYS = 400;
    uint256 internal constant QUALIFIED_PTS = 25;
    uint256 internal constant MAX_QUALIFIED = 250;
    uint256 internal constant BACKING_PTS = 3;
    uint256 internal constant MAX_BACKING = 150;
    uint256 internal constant AGE_PTS = 5;
    uint256 internal constant MAX_AGE = 200;

    function score(Inputs memory i) internal pure returns (uint256) {
        if (i.defaulted) return 0;

        uint256 dollarDays = i.dollarSecondsRepaid / 1 days / 1e6;
        if (dollarDays > MAX_DOLLAR_DAYS) dollarDays = MAX_DOLLAR_DAYS;

        uint256 q = i.qualifiedRepaid * QUALIFIED_PTS;
        if (q > MAX_QUALIFIED) q = MAX_QUALIFIED;

        uint256 backing = i.lineAmount * BACKING_PTS / 1e6;
        if (backing > MAX_BACKING) backing = MAX_BACKING;

        uint256 age;
        if (i.firstRepaidAt != 0 && i.nowTs > i.firstRepaidAt) {
            age = (i.nowTs - i.firstRepaidAt) / 1 days * AGE_PTS;
            if (age > MAX_AGE) age = MAX_AGE;
        }

        return dollarDays + q + backing + age;
    }
}
