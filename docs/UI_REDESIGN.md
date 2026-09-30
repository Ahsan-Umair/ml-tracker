# Model Lab interface redesign

September 30, 2026

## Research and decisions

- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — show the main task first and reveal secondary choices when needed. Owner setup separates identity from security; recovery keeps a two-step flow.
- [GOV.UK Design System: Password input](https://design-system.service.gov.uk/components/password-input/) — visible labels, password-manager support, and a named show/hide control. Autocomplete and paste remain supported, with errors beside the form.
- [web.dev: Animations and performance](https://web.dev/articles/animations-and-performance) — avoid animation that repeatedly triggers layout or paint. The design uses static SVG illustrations, CSS bars, flat surfaces, and reduced-motion support. Only pending-action indicators animate.

## Changes

Evergreen navigation, neutral surfaces, teal actions, native SVG branding, consistent forms, redesigned sign-in, two-step owner setup, and recovery screens. Existing accounts, session security, and owner-only registration are retained. Mobile navigation uses labeled links in a native dialog with keyboard support. The dashboard includes onboarding for empty accounts and links to runs and models. Recharts is replaced with SVG/CSS charts, exact values, and a readable daily-score disclosure. Settings copy is simplified.

## Performance

Initial JavaScript summed from production HTML script references and gzip-compressed locally. Values are KiB; these are payload estimates, not browser timing benchmarks.

| Route | Before gzip | After gzip |
| --- | ---: | ---: |
| Login | 187.9 | approximately 189 |
| Dashboard | 190.9 | approximately 191 |
| Analytics | 306.2 | approximately 189 |
| Projects | 190.3 | approximately 191 |

Analytics initial JavaScript is approximately 38% smaller. Removing Recharts removed 39 installed packages. Login and dashboard payload sizes are essentially unchanged. The redesign does not claim faster backend responses.

The free Render backend can still take time to wake after inactivity. A delayed sign-in status message explains this wait. Hosting remains Vercel + Render + Turso on existing free plans.

## Verification

- Production build and TypeScript check, ESLint, and six existing frontend API tests.
- Browser checks: valid/invalid login; empty and populated dashboards; project dialog; Escape and focus restoration; mobile navigation and analytics; setup forward/back retains details; recovery forward/back retains email/code.
- Account creation and password reset submissions were not performed against production.
