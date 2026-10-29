# Model Lab

A personal workspace for ML projects, datasets, model versions, experiments, runs, and metrics. The application uses Next.js/React/TypeScript, FastAPI, and Turso/libSQL. The old Streamlit/MySQL prototype has been removed.

## Architecture

| Component | Directory | Target |
| --- | --- | --- |
| Web interface | `frontend/` | Existing Vercel Hobby frontend project |
| FastAPI API | `backend/` | Separate Vercel Hobby API project |
| Durable records, sessions, tokens | External database | Existing Turso Free database |
| Notebook client | `sdk/` | Your local training environment |

The browser uses first-party `/api/*` URLs. Next.js proxies these to the backend origin in `API_ORIGIN`. Database credentials stay on the API service. Training and inference computation remain in your own environment; the app records their metadata and measurements.

The repository targets Vercel for both services. This configuration alone does not move production traffic: follow [the deployment and cutover guide](docs/DEPLOYMENT.md). Keep the previous API online until the new deployment passes verification.

## Features

- Owner-only production registration, Argon2id passwords, secure HttpOnly sessions, CSRF checks, ownership enforcement, database-backed login/recovery throttling, and single-use recovery codes.
- Detail pages and editable metadata for projects, datasets, models, experiments, and runs; model-version browsing and lifecycle promotion.
- An experiment-specific primary metric, split, unit, optimization direction, and best/final aggregation. Comparisons stay within the same experiment and evaluation protocol.
- Metric history and curves, side-by-side run/configuration comparison, CSV reports, and experiment-scoped leaderboards.
- Tags, search, filters, sorting, server pagination, and account-scoped saved view preferences on the current device.
- Guided parameter entry with JSON support, provenance/checksums, parent runs, contextual onboarding, and informative deletion previews. Projects can be archived without deleting data.
- Profile/password controls, session revocation, project-scoped expiring API tokens, workspace/project JSON export, and validated import previews that copy records with new IDs.
- Dark/light appearance, keyboard navigation and command palette, reduced-motion support, mobile navigation, chart data alternatives, and localized loading/error feedback.
- Dependency-free Python client with atomic metric batches and idempotency. See [the client guide](sdk/README.md).

## Free-plan policy

Use Vercel Hobby and Turso Free only. Do not enable paid resources, paid add-ons, or metered upgrades. Hobby is intended for personal non-commercial use and enforces usage quotas. No keep-alive traffic is needed.

## Local development

Python 3.13 matches the deployment pin. Node 24 LTS is recommended; the frontend requires Node 22.13 or newer.

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Without Turso credentials, development uses `backend/data/model_lab.db`. Production requires Turso and refuses local persistence.

In another terminal:

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Create a development account and your first project. Do not point local or preview tests at the production database.

## Recording results

Choose an experiment's exact metric, split and unit. For example `val_accuracy`, `validation`, `fraction`, `max`, `best`; enter `.95` for 95%. For validation loss use a numeric unit and `min`. Model Lab does not infer percentage units from a number's size, mix training/test readings, or rank unrelated experiments as equivalent.

In Settings, create a token scoped to the intended project. Install the client with `pip install ./sdk`, store credentials in environment variables, and follow [the notebook example](sdk/README.md). API-token secrets are shown once. Exported workspace JSON excludes password hashes, sessions, API tokens, and recovery credentials, but still contains your experiment data and should be stored privately.

Legacy accuracy history is migrated using the previous interface’s display convention, while preserving raw values. If historical units are mixed or uncertain, the experiment is marked for review and ranked scores stay hidden until the owner explicitly confirms its metric policy.

## Account recovery

Create and save a recovery code in Settings. `/recover` consumes the current code, changes the password, revokes existing access, and provides a replacement code once. If the owner has no usable code, run `python scripts/issue_recovery_code.py` inside `backend/` privately. Configure its generated emergency hash and UTC expiry on the API host, redeploy, recover, then remove those emergency variables. Never paste raw codes or credentials in logs or commits.

## Checks

```bash
cd backend
python -m pytest -q
cd ../sdk
python -m unittest discover -s tests -v
cd ../frontend
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
# With the local API and web servers running:
npm run test:e2e
```

The browser checks create their own development accounts and records. Run them against disposable development data only. `.github/workflows/ci.yml` runs backend, SDK, TypeScript, lint, production build, and Chromium integration checks on Linux/Python 3.13.

`/api/health` checks process liveness; `/api/ready` also checks database connectivity. `/api/docs` describes API contracts. Logs include request IDs/status/timing and exclude request bodies, query strings, cookies, and authorization values.

## Data safety and maintenance

Schema migrations are incremental and preserve existing records. Back up before a production migration and test restore/import with disposable data. Import validates foreign-key relationships and creates new IDs without replacing existing projects. Review deletion previews before permanently removing a record. Prefer archival when retaining history matters.

List APIs return arrays with `X-Total-Count`, bounded `limit` and `offset`, and supported filters. Charts use bounded histories; paginate or export the underlying readings when needed. The current implementation does not provide hosted model training, uploaded artifact storage, or collaboration accounts; it keeps artifact/dataset references and private owner access.
