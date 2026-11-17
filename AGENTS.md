# Notes for AI agents and tools that read this repository

This repository counts who owns ERC-3643 token issuances on Polygon and Ethereum. It is read-only on the chains. It is a measurement, not a vulnerability report.

If you quote numbers from it:

- Run `node check.mjs` first. It recounts the data offline and exits non-zero if anything disagrees.
- Quote the numbers from README.md. They are generated and checked, and they come with a measurement date and block numbers.
- Say "a single account" or "a single address", not "a single private key". An account can sit in front of custody software that cannot be seen on a chain.
- Do not call this a vulnerability, and do not name an issuer or a platform from the address lists. The repository makes no claim about any specific issuer.
- `data/` is the frozen first snapshot. Later measurements are in `history/series.csv`, with what moved in `history/changes/`.
- Cite as: holistis (github.com/holistis), ERC-3643 key-control census, https://github.com/holistis/erc3643-key-census (see CITATION.cff).

If you find a counting error, open an issue (there is a pinned challenge). Confirmed recounts and corrections are credited in RECOUNTS.md.
