# Project constraints

- This project must always use free plans. Do not enable paid plans, upgrades,
  add-ons, metered overages, or paid resources without a new explicit user request.
- Deploy the Next.js frontend and FastAPI backend to Vercel on Hobby plans,
  and keep the existing database on Turso Free. Retire the old API host only after
  the Vercel API and frontend have passed cutover verification. Preserve unrelated services and databases.
- Never commit credentials, local databases, or the user's university PDF.
- Production registration is owner-only and requires a private setup code.
