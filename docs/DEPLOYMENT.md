# Vercel deployment and operations

Use only the existing personal Vercel Hobby workspace and Turso Free database. Do not enable paid resources, paid add-ons, or metered upgrades. Preserve unrelated services and databases.

## Completed migration — October 29, 2026

Model Lab now runs its Next.js frontend and FastAPI API on Vercel. The existing Turso database remains the durable store. The Streamlit/MySQL prototype and obsolete deployment configuration were removed from the source.

| Component | Project | Production URL | Verified production deployment |
| --- | --- | --- | --- |
| Frontend | `model-lab` · `prj_A46UAnQCqKAnizuS3ELGzryDzQKu` | [model-lab-rho.vercel.app](https://model-lab-rho.vercel.app) | `dpl_CbaLv5jCZEEMr2gRbb1Frv1zjZcK` |
| FastAPI API | `model-lab-api` · `prj_ALnR7BYsbc69t5V5TpQyIC0xvhTe` | [model-lab-api.vercel.app](https://model-lab-api.vercel.app) | `dpl_4owmiNwpCwFtYcoPXisvDicFKCNu` |

Both projects belong to the existing `au22` workspace (`team_H2Or2gfNs42VcaflImigXkUT`). Their repository is `Ahsan-Umair/ml-tracker`. The reviewed application commit is `30f42ac3ef96db9384f181476c0d8f82dc352184`.

The API was verified on Vercel's native Linux/Python 3.13 runtime, with HTTP 200 from `/api/health` and `/api/ready`. The frontend was staged without assigning production aliases, tested, then promoted; the canonical frontend alias was verified to resolve to the production deployment above. The existing owner's authenticated dashboard and Settings continued to work. Runtime and browser checks found no application errors.

A **private pre-cutover backup** was retained outside the repository. Preservation checks verified existing data and database schema version 3; normal expired-session cleanup completed. Backup locations, credentials, account identifiers, and record contents are deliberately excluded from this document.

[GitHub CI run 40917774041](https://github.com/Ahsan-Umair/ml-tracker/actions/runs/40917774041) passed for the exact application commit above. The Linux workflow completed Python 3.13 dependency installation and backend tests, SDK checks, frontend tests, TypeScript, lint, the production build, and Chromium/browser/API integration. Its only annotation was an informational GitHub runner-image notice.

After cutover verification and the owner's action-time approval, the old Model Lab Render service `srv-da9qlelg1s2s73b7t120` was deleted. Render subsequently reported that the service ID did not exist. Turso and unrelated resources were preserved. **The old Render API is no longer a rollback target.**

## Verify deployment targets

Keep the frontend project root `frontend` and the API project root `backend`. FastAPI's `app/main.py` is detected natively. `backend/.python-version` pins Python 3.13 and `backend/vercel.json` sets a bounded function duration. Vercel does not require a Uvicorn Start Command.

Before changing cloud configuration, verify the intended workspace, project, commit, and environment. Do not switch to an unrelated workspace to work around an authorization error. Use the existing projects for normal releases; create a new Hobby API project only when intentionally setting up another environment or workspace.

Deploy the reviewed committed source, including newly added files. If deploying from an uncommitted checkout with the files API, use an explicit source allowlist and truthful dirty-source metadata. Exclude private environment files, local databases, the university PDF, caches, dependencies, and build output from source uploads.

## Back up and stage future releases

1. Confirm that the API targets the intended external Turso database. Before a schema migration, make and verify a private backup. Never copy or delete unrelated databases or services.
2. Record the current compatible Vercel API/frontend deployment IDs and frontend `API_ORIGIN` privately for rollback. The deleted Render service must not be treated as available.
3. Run backend, SDK, frontend, and Chromium integration checks against disposable local data. Use a separate Turso test database for deployment previews; never run registrations or destructive tests against production.
4. Configure environment variables directly in the intended Vercel project. Keep database credentials server-only. Do not commit them, expose them through `NEXT_PUBLIC_*`, or paste them in chat or build logs.

| API variable | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `TURSO_DATABASE_URL` | Existing intended Turso URL; server-only secret |
| `TURSO_AUTH_TOKEN` | Token for that database; server-only secret |
| `FRONTEND_ORIGINS` | Exact approved frontend origin(s), comma-separated; no wildcard |
| `COOKIE_SECURE` | `true` |
| `OWNER_EMAIL` | Existing owner email |
| `ALLOW_REGISTRATION` | `false` for an existing account |
| `SESSION_DAYS` | Existing preference, default 30 |

For a brand-new empty database only, open registration temporarily with a private random `REGISTRATION_TOKEN` of at least 32 characters, register the owner, then close it. Preserve the current account and database for normal releases. Do not automatically restore stale emergency recovery environment values.

5. Stage the API and check `/api/health` and `/api/ready`. Review native `libsql` and Argon2 compatibility whenever changing Python or dependency versions. Startup applies additive schema migrations; verify repeated startup preserves records.
6. Verify that API deployment protection permits the frontend proxy to reach the API. Inspect the actual response. Do not disable unrelated project protection, application authentication, or database ownership checks.

## Stage and release the frontend

1. Keep frontend `API_ORIGIN` set to the stable API HTTPS origin, currently `https://model-lab-api.vercel.app`, without a path or API prefix. Keep `NEXT_PUBLIC_SITE_URL` aligned with the canonical frontend origin when explicitly configured. `API_ORIGIN` is evaluated at build time, so redeploy after changing it.
2. Stage a production-scoped build without changing the live alias when the deployment tool supports that workflow. Promote the tested production build rather than an untested rebuild.
3. Verify first-party HttpOnly/Secure cookies, session lookup, CSRF rejection/acceptance, sign-in/sign-out, metric rankings, detail/edit pages, scoped token logging, and database persistence. Use a separate test database for destructive recovery, import, or delete checks. Do not rotate the owner's password or recovery code merely to test production.
4. Promote the tested build. Confirm the normal frontend alias resolves to it and its `/api/*` requests reach the intended Vercel API. Inspect readiness and runtime errors after release.
5. Retain a compatible Vercel deployment for rollback. If replacing another host in the future, retire only that confirmed application service after cutover checks pass; preserve databases and unrelated resources.

## Rollback after Render retirement

Prefer a prior **compatible Vercel deployment** for the affected frontend or API, after verifying that it supports the current database schema and API contract. The production deployments recorded above are the verified migration baseline; reassess compatibility before using them after later schema changes.

A frontend built before this migration may still proxy requests to the deleted Render service. Promoting that frontend alone would break the API path. Do not restore an old Render `API_ORIGIN` unless a replacement backend has first been recreated, configured with the correct private environment values, and verified healthy. Recreating a backend host is a separate deployment operation, not an immediate rollback.

Schema migrations are additive. Do not drop new columns or restore an old database snapshot over newer user data. Stop incompatible writers and assess changes before any database restore. Keep backups and recovery material private.

## Completion criteria for future releases

A release is complete when the live frontend uses the intended verified API, existing data and account access work, recovery and notebook credentials remain safe, required checks pass, and production aliases resolve to the tested deployments. A local configuration change or healthy process endpoint alone is insufficient.

Official references: [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi), [Python API migration](https://vercel.com/kb/guide/migrate-a-python-api-from-render-to-vercel), [Hobby limits](https://vercel.com/docs/plans/hobby).
