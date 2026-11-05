# Contributing

- `npm install`, then `npm run typecheck && npm test && npm run build` must pass.
- Spec changes (`spec/AICP-v1.md`) need a matching code/test change and a CHANGELOG entry. Normative
  wording uses RFC 2119 keywords. Breaking wire changes require a new major protocol version.
- Security-relevant code (`src/signatures.ts`, `src/protocol.ts` webhook verification, `src/client.ts` signing)
  needs a test that fails without the change.
- Never commit keys, tokens or real buyer data in tests or examples; generate keys in the test.
- Report vulnerabilities privately to the maintainers (see SECURITY.md), not in public issues.
