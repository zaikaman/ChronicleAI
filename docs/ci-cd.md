# CI/CD

ChronicleAI uses GitHub Actions for verification. Production delivery remains managed by the existing Heroku and Vercel provider integrations.

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests and pushes to `main`. It installs the locked pnpm dependency graph, then runs:

```bash
pnpm type-check
pnpm test
pnpm build
```

The same gates are available locally with `pnpm verify:ci`.

## Continuous delivery

The existing Heroku GitHub integration auto-deploys commits from the repository to the API. The web app already has a Vercel-specific configuration in `apps/web/vercel.json`, so its production deployment remains managed by the linked Vercel project.

There are no Heroku deployment secrets required by this repository’s GitHub Actions. Provider-side deployment settings remain outside the repository.

## Formatter debt

The repository’s existing `pnpm check` command currently reports pre-existing Biome diagnostics across unrelated files. It is intentionally not a CI gate yet; type-checking, tests, and the production build are enforced first so the deployment status reflects executable production safety checks.
