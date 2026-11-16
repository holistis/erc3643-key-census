# ERC-3643 key-control census

Who holds the keys of ERC-3643 token issuances on Polygon and Ethereum? This repository counts it. Everything was read from public chains. Nothing was written to a chain, tested against, or touched.

Spanish summary: [README.es.md](README.es.md)

## The numbers

![Who holds the keys of ERC-3643 token issuances](assets/key-control.svg)

<!--SUMMARY-->
Of 3427 token issuances (3363 on Polygon, 64 on Ethereum), 97.2% have a single account or a Safe that needs one signature as owner, and 0.3% need more than one party (a Safe with a threshold of two or more, or a timelock that answers getMinDelay()).
Among the 1052 active issuances (supply above zero, not paused) the shares are 95.7% and 0.8%.
The 50 largest of the 222 distinct final controllers of active issuances are the final controller of 80% of the active issuances (counted per issuance, not by supply).
The 3427 issuances come from 222 distinct factory contracts that emitted the standard event. Anyone can deploy such a factory, so the list includes small and test deployments.
Measured on 2026-11-16 at Polygon block 97439700 and Ethereum block 26430325.
<!--/SUMMARY-->

<!--NUMBERS {"tokens":3427,"active":1052,"single_key_pct_all":97.2,"multi_party_pct_all":0.3,"single_key_pct_active":95.7,"multi_party_pct_active":0.8,"distinct_factories":222,"distinct_controllers_active":222,"top50_controllers_share_active_pct":80,"discarded":{"duplicates_skipped":0,"invalid_address_skipped":0,"transport_failures":0,"unreadable":0}} -->

Data fingerprint (sha256 of data/tokens.json): `5d8aa148e0c497dee6171809c103a484abfd8a0cf587f0b969fec57407a90356`

"Active" means total supply above zero and not paused. Supply is counted in token units, not in money, and many issuances are small or are tests. Shares are counted per issuance, not by supply.

## How the list was made

`node discover.mjs` lists every token announced by the standard `TREXSuiteDeployed` event (topic0 `0x057adae5fa3e9caa8a0d584edff60f61558d33f073412ec2d66d558b739e0a41`) on both chains, from block 0 to the block recorded in `data/discovery.json`. Any contract that emits this event counts as a factory, and anyone can deploy one, so the list includes small, hobby and test deployments. The factory count is in the numbers above. The default log source is a public gateway that returns the full history in one call; it can change or disappear, so `--rpc` and `--chunk` let you use another node.

## What was measured

For every token in that list:

1. Read `symbol()`, `totalSupply()`, `paused()` and `owner()` through Multicall3. Symbols are used only to see whether a token answers; they are not published.
2. Follow `owner()` through contracts until it reaches an account, a Safe, a timelock, or a dead end. The last stop is called the final controller.
3. Classify the result:

| type | meaning |
|---|---|
| account_direct | `owner()` is an account (no code, or an EIP-7702 delegated account) |
| account_via_contract | `owner()` is a contract whose `owner()` chain ends at an account |
| safe_threshold_1 | a Safe where one signature is enough |
| safe_multisig | a Safe with a threshold of two or more |
| timelock | a contract that answers `getMinDelay()` |
| other_contract | a contract that is none of the above, including timelocks and governors that do not answer `getMinDelay()` |
| renounced | the owner is the zero address or `0x...dead` (not counted as a controller) |
| no_owner, self_owned, cycle, too_deep, not_measured, unreadable | edge cases, all counted |

An account with exactly 23 bytes of code that starts with `0xef0100` (EIP-7702 delegation) is counted as an account.

Single key means: one account address, or a Safe that needs only one signature. Multi party means: a Safe with a threshold of two or more, or a timelock that answers `getMinDelay()`.

## What this does not show

- An account address can be backed by custody software (MPC, HSM, a custodian). That cannot be seen on a chain, so "single key" means "a single address", not "a single private key".
- Only the `owner()` role was measured. Agents, who in ERC-3643 can mint, freeze or force transfers, were not.
- A Safe with a threshold of two or more is counted as multi party even when a module (for example a delay or roles module) lets fewer signers act. A timelock is counted as multi party even when one account proposes. Compound-style timelocks and governors are in other_contract.
- Only issuances announced by the standard factory event are in the list. Issuers that deploy in another way are not.
- Supply is not value. A large share of issuances is probably small or test deployments.
- This is an observation about who can act. It is not a statement that anything is wrong. No issuer or platform is named, and no claim is made about any specific issuer. Addresses are public chain data.

## Recount it yourself

Node 22 or newer (tested on 24 and, in CI, 22). No dependencies.

```
node check.mjs                  # offline recount: data, summary, README numbers and sentences, chart, discovery counts, fingerprint
node check.mjs --selftest       # plants errors in a copy and requires every one to be caught
node check.mjs --verify-chain   # re-measures a deterministic sample of 200 tokens from the chains (type and controller); red above 5 percent difference, --strict for any
node discover.mjs list.json     # rebuilds the token list from the chains
node census.mjs list.json out/  # re-measures every token (numbers drift as owners change and new issuances appear)
node check.mjs --compare out/tokens.json   # compares your full recount with data/tokens.json
node --test                     # unit tests, including a mock RPC server for discovery and for the whole counting process
```

`check.mjs --selftest` plants at least thirty errors in a copy of the data (a fake id, a flipped type, one row removed, an empty list, a truncated file, a changed number in the README and more) and fails if any of them goes unnoticed. `test/meta.test.mjs` then disables the checks one at a time and requires the selftest to turn red. One limit is known: a simultaneous and consistent edit of rows, summary, fingerprint and README cannot be seen offline. `--verify-chain` would catch it only if an edited row is in the sample. A full recount followed by `--compare` catches all of it.

An early version of the classifier counted accounts with EIP-7702 delegation as contracts. That was found by sampling on a second node, corrected, and is now covered by tests.

Counts of anything skipped, duplicated or unreadable are part of the numbers block above, under `discarded`.

## Corrections and recounts

Corrections are listed here and are never silent. If you recount and get a different number, please open an issue with your command and block number. Recounts by others are welcome and will be credited in this README.

## Cite as

holistis (github.com/holistis), ERC-3643 key-control census, 16 November 2026, https://github.com/holistis/erc3643-key-census

## License

Code: MIT, see LICENSE. Data in `data/`: CC BY 4.0, please cite as above.
