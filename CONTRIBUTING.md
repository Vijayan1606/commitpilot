# Contributing

Thanks for looking. This project values correctness and honesty over feature count: a smaller tool that reports what it actually observed is better than a broad tool that guesses.

## Development

```bash
npm ci
cp .env.example .env.local
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
```

`npm run smoke` starts the production build, registers the synthetic demo repository through the API, and runs 20 runtime checks.

## Ground rules

- **Never commit credentials, private repository content, or customer data.** Fixtures must stay synthetic. `.env` files are ignored on purpose.
- **Keep repository content out of logs and model prompts beyond the bounded evidence path.** If you add a feature that reads files, route it through `readRepositoryFile` and the path guard.
- **Do not add a shell.** Commands are a structured allowlist with `execFile` and fixed argv. Model or user text must never become an argument string.
- **Do not let the model increase its own permissions.** Tools are dispatched deterministically; the model's output is data, never an instruction.
- **Findings must cite evidence.** If a path or line cannot be verified, store `null` and use the correct verification status.
- **No fabricated success states.** If a model call fails, fail the job. If a test was not run, say so.
- **Update tests with behaviour changes.** Security regressions belong in `tests/security/`.

## Adding a tool

1. Add a definition in `src/server/tools/definitions.ts` with a Zod input schema, output schema, risk, timeout, and annotations.
2. Validate every path through the existing guards.
3. Return JSON-serialisable data with a stable shape.
4. Add a test for the happy path and at least one rejection path.
5. Update `docs/alan-integration.md` if the tool is user-facing.

## Adding a security rule

Rules live in `src/server/analysis/securityRules.ts`. Keep them narrow enough to avoid noise, label the result as a lead (not a vulnerability), and add a fixture that triggers it. Do not write a scanner from scratch.

## Pull requests

- Describe the behaviour change and how you verified it.
- Run `npm run verify` and `npm run build`.
- Keep unrelated refactors out of the diff.

## Reporting security issues

Do not open a public issue for a vulnerability. Contact the maintainer privately with reproduction steps and the affected version.