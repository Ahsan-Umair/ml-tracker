# Vercel deployment and safe API cutover

Use only the existing personal Vercel Hobby workspace and Turso Free database. The source migration removes the legacy Streamlit/MySQL application and its deployment files. Removing the old host's configuration does not itself retire its running API.

## Verify the target

The existing frontend project discovered during inspection is `model-lab` (`prj_A46UAnQCqKAnizuS3ELGzryDzQKu`) in team `team_H2Or2gfNs42VcaflImigXkUT`. Its repository is `Ahsan-Umair/ml-tracker`. Confirm these still match before changing cloud configuration. The connected Vercel app may require the owner to grant team access; do not work around a denied grant or switch to an unrelated workspace.

Keep the existing frontend project root `frontend`. Create a separate FastAPI project with root `backend`; this avoids changing the existing frontend project's deployment model. FastAPI's `app/main.py` is detected natively. `backend/.python-version` pins Python 3.13 and `backend/vercel.json` sets a bounded function duration. No Uvicorn Start Command is required on Vercel.

## Back up and stage

1. Confirm the production database is the intended external Turso database. Make a database backup/export and keep it private. Do not copy or delete unrelated databases/services.
2. Keep the original API running and record its origin/configuration privately for rollback. Record the current frontend deployment ID and its `API_ORIGIN`.
3. Run backend/SDK/frontend checks and Chromium integration tests against a disposable local database. Use a separate Turso test database for deployment previews; never let test registrations or destructive tests touch production.
4. Create a Hobby API project and configure its variables directly in Vercel. Do not place tokens in browser-facing environment variables, commit them, or paste them in chat.

| API variable | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `TURSO_DATABASE_URL` | Existing intended Turso URL; server-only secret |
| `TURSO_AUTH_TOKEN` | Token for that database; server-only secret |
| `FRONTEND_ORIGINS` | Exact frontend origin(s), comma-separated; no wildcard |
| `COOKIE_SECURE` | `true` |
| `OWNER_EMAIL` | Existing owner email |
| `ALLOW_REGISTRATION` | `false` for an existing account |
| `SESSION_DAYS` | Existing preference, default 30 |

For a brand-new empty database only, open registration temporarily with a private random `REGISTRATION_TOKEN` of at least 32 characters, register the owner, then close it. Preserve an existing account/database instead of creating a replacement. Do not automatically migrate stale emergency recovery environment values.

5. Deploy the API and check `/api/health` and `/api/ready`. Review native `libsql` and Argon2 dependency compatibility on Vercel's Linux/Python 3.13 runtime. Startup applies additive schema migrations. Verify that repeating startup preserves records.
6. Backend deployment protection must allow the frontend proxy to reach the API. Check the actual protected deployment response; do not disable unrelated project protection. Keep application authentication and database ownership checks enabled.

## Cut over the frontend

1. Set frontend `API_ORIGIN` to the new API's stable HTTPS origin, without a path or trailing API prefix. Keep `NEXT_PUBLIC_SITE_URL` as the stable frontend origin when explicitly configured. `API_ORIGIN` is evaluated at build time, so redeploy after changing it.
2. Stage the frontend using production-scoped configuration without moving the live domain when the deployment tool supports it.
3. On the staged deployment, verify first-party HttpOnly/Secure cookies, session lookup, CSRF rejection/acceptance, sign-in/sign-out, exact metric rankings, detail/edit pages, scoped token logging, and database persistence. Use a separate test database for destructive recovery/import/delete checks. Do not rotate the owner's password or recovery code merely to test production.
4. Promote the tested production build. Confirm the normal frontend domain reaches the new API and data remains intact. Inspect error logs and readiness after cutover.
5. Keep the old API available for rollback until verification succeeds. Then remove only the confirmed old Model Lab API service. Do not delete the hosting account, unrelated services, or Turso.

## Rollback

Before changing traffic, record the frontend's previous `API_ORIGIN` and deployment. If cutover fails, restore the old origin and rebuild the frontend or promote the known-good production deployment whose proxy targets the old host. The new schema migrations are additive; do not drop new columns or restore an old database over newer user data. Stop incompatible writers and assess data changes before any database restore.

## Completion criteria

Migration is complete only when the live frontend uses the verified Vercel API, existing data/account access work, recovery and notebook credentials remain safe, all required checks pass, and the old API service has actually been retired. A local configuration change or healthy process endpoint alone is insufficient.

Official references: [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi), [Python API migration](https://vercel.com/kb/guide/migrate-a-python-api-from-render-to-vercel), [Hobby limits](https://vercel.com/docs/plans/hobby).
