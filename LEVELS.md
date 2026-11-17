# Control levels for ERC-3643 issuances

A shared vocabulary for one question: how many parties must agree before the role holders of a token can act.

## Role holders

A token has one owner and any number of agents. In the T-REX token contract the owner adds and removes agents (`addAgent` and `removeAgent` are `onlyOwner`), and every agent can mint, burn, freeze, force transfers and pause on its own (`onlyAgent`). So the role holders of a token are:

- the owner, and
- every current agent of the token contract,

leaving out any role holder that cannot act: the zero or dead address, or the token itself.

Each role holder is followed to its final controller exactly as the owner is in the README: an account (also with EIP-7702 delegation), a Safe, a timelock, or a contract whose `owner()` chain ends somewhere.

## The levels

| level | definition |
|---|---|
| Level 0 | at least one role holder is a single key: an account, a Safe that needs one signature, or a contract whose `owner()` chain ends at an account (the same reading as the owner numbers in the README). That key can act alone, or through that contract. |
| Level 1 | every role holder is a Safe that needs two or more signatures. |
| Not classified | no single key was found, but not every role holder is a Safe with a threshold of two or more (for example an unknown contract, a timelock, or a renounced owner without agents). |

The weakest role holder decides. A token whose owner is a three-signer Safe with a threshold of two is still at Level 0 if one agent is a single account, because that agent can mint or force a transfer without anyone else (`onlyAgent` in [Token.sol](https://raw.githubusercontent.com/TokenySolutions/T-REX/main/contracts/token/Token.sol) and `onlyOwner` for adding agents in [AgentRoleUpgradeable.sol](https://raw.githubusercontent.com/TokenySolutions/T-REX/main/contracts/roles/AgentRoleUpgradeable.sol), read on 17 November 2026; a token deployed from another version of the contracts may differ).

## What a level does not say

- It does not rate an issuer. An issuer may have good reasons for a fast single freeze key, and an address can sit in front of custody software (MPC, HSM, a custodian) that a chain cannot show. Level 0 means "a single address can act", not "insecure".
- Level 1 does not say that the signers are independent people. A Safe with two signers who are the same person is Level 1.
- A Safe module that lets fewer signers act is not read.
- Only the agents of the token contract are read. The identity registry, the compliance modules and any upgrade authority are not.
- The owner numbers at the top of the README count a timelock as more than one party. Level 1 does not, because who may propose to a timelock is not read. No token owner in the first snapshot is a timelock (see `types_all` in `data/summary.json`), so the two never disagree there.
- There is no level above Level 1. A delay window (a timelock with a proposer check) cannot be told apart from a single proposer behind a delay with the data read here, so a level for it is left undefined until it can be measured.

## How it is counted

The rule is `tokenLevel` in `lib/levels.mjs`, about ten lines. `data/agents.json` stores the owner type, the agents and the level of every token. `node check.mjs` recomputes the level of every row, recounts the numbers in the README, and compares the total number of agents with the event counts. That catches an agent dropped or invented on its own. It does not catch one agent dropped and another invented, or an agent moved to another row, in a file where rows, summary, fingerprint and README were all edited together; only a recount against the chains does. Changing a definition here changes the counts, and a change is listed in the README under corrections.

## Cite as

holistis (github.com/holistis), ERC-3643 key-control census, control levels, 17 November 2026, https://github.com/holistis/erc3643-key-census/blob/main/LEVELS.md
