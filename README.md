# Model Lab

Model Lab is a personal ML model registry and experiment tracker. It keeps projects, dataset references, model versions, experiments, runs, hyperparameters, environments, and metrics in one account-scoped workspace.

The original Streamlit/MySQL university prototype is still present at the repository root for reference. The production application lives in `frontend/` and `backend/`.

## Production architecture

| Layer | Technology | Host |
| --- | --- | --- |
| Interface | Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query, Recharts | Vercel |
| API | FastAPI, Pydantic, secure cookie sessions, Argon2id | Render |
| Database | Turso/libSQL in production; SQLite locally | Turso |

The browser calls `/api/*` on the Vercel domain. Next.js proxies those requests to Render, which keeps the session cookie first-party and avoids putting bearer tokens in browser storage.

### Free-plan policy

This project must always stay on free plans: Vercel Hobby, Render Free, and Turso Free.
Do not enable paid upgrades, add-ons, or automatic overages. If a free quota is reached,
stop and explain the limit instead. Render may sleep when idle; its free instance hours
are shared with other free services in the same workspace.

## What works

- Personal account registration, sign-in, sign-out, and expiring revocable sessions
- Argon2id password hashing, HttpOnly/Secure/SameSite cookies, CSRF protection, origin checks, and login throttling
- Strict per-user ownership checks for every protected record
- Projects with cascade-safe deletion
- Dataset metadata and external/local URI references
- Model registry with immutable named versions and lifecycle stages
- Experiments linked to a project, model, and dataset
- Training, evaluation, and inference runs with JSON hyperparameters and environment capture
- Arbitrary metrics by step/epoch
- Live dashboard, leaderboard, and analytics
- Responsive keyboard-friendly interface with reduced-motion support

## Local setup

Use Python 3.13 for parity with Render. Python 3.14 may try to compile the current libSQL client locally.

### 1. Start the API

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

With no Turso variables, the API creates `backend/data/model_lab.db` automatically.

### 2. Start the interface

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`, register an account, and create the first project.

## Deploy Turso

1. Create a Turso database.
2. Copy its `libsql://...turso.io` URL.
3. Create a database auth token.
4. Keep both values private; they belong only in Render environment variables.

The API creates the required tables and indexes safely at startup. The frontend never receives database credentials.

Official guide: [Turso Python quickstart](https://docs.turso.tech/sdk/python/quickstart).

## Deploy the API to Render

The repository includes `render.yaml`.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Add these secret/environment values:
   - `TURSO_DATABASE_URL`: the Turso database URL
   - `TURSO_AUTH_TOKEN`: the Turso auth token
   - `FRONTEND_ORIGINS`: the exact Vercel URL, then your custom domain when connected
4. Keep `COOKIE_SECURE=true`.
5. Set `APP_ENV=production`, `OWNER_EMAIL` to your email, and `REGISTRATION_TOKEN` to a
   private random setup code of at least 32 characters. Share the code with the owner only.
6. Register with the owner email and setup code, then set `ALLOW_REGISTRATION=false`.
   Keep the password in your password manager; password-reset email is not implemented.

The health check is `/api/health`; API documentation is available at `/api/docs`.

Official guide: [Deploy FastAPI on Render](https://render.com/docs/deploy-fastapi).

## Deploy the interface to Vercel

1. Import the same GitHub repository into Vercel.
2. Set the project root directory to `frontend`.
3. Add `API_ORIGIN` with the Render service origin, for example `https://model-lab-api.onrender.com` (no trailing slash).
4. Deploy.
5. Copy the final Vercel origin back into Render's `FRONTEND_ORIGINS` and redeploy the API.

For preview deployments, add each preview origin to `FRONTEND_ORIGINS`, comma-separated, or use a stable custom preview domain. Do not use a wildcard with credentialed requests.

## Cloudflare

Turso is the database provider. Cloudflare is optional in this design: use it for DNS, a custom domain, and edge security in front of Vercel/Render if desired. It does not replace Turso unless the backend is intentionally redesigned around Cloudflare D1.

## Verification

```bash
cd frontend && npm run lint && npm run build
cd ../backend && pytest -q
```

The backend test covers the complete account → project → dataset → model/version → experiment → run → metric → dashboard/leaderboard flow, including CSRF rejection and logout.
