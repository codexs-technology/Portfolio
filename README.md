# Mehboob Masih — personal portfolio

React + TypeScript + Vite + Tailwind; Hono on Cloudflare Workers with Static Assets; D1 CMS; optional private R2 binding. No invented projects or employment dates. Owner facts are seeded; public projects start empty.

## Local development (Windows PowerShell)

```powershell
Set-Location 'D:\My Portfolio'
npm.cmd ci
Copy-Item .dev.vars.example .dev.vars
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Put generated value in LOCAL_ADMIN_TOKEN inside .dev.vars; never commit it.
npm.cmd run db:local
npm.cmd run build
npm.cmd run preview
```

Visit http://127.0.0.1:8787 and /admin. The local token must have at least 32 characters and is accepted only with ENVIRONMENT=local on a loopback hostname. Outside local development, authentication requires a verified Cloudflare Access JWT and an exact ADMIN_EMAIL match. There is deliberately no password login, stored password, or default admin credential.

For fast frontend updates, run `npm.cmd run dev` in another terminal; Vite proxies API requests to 8787. Test authentication on the Wrangler origin, not across mixed origins.

## Checks

```powershell
npm.cmd run check
npx.cmd playwright install chromium
$env:LOCAL_ADMIN_TOKEN = '<same generated value as .dev.vars>'
npm.cmd run test:e2e
```

Tests use the **local** D1 database and transient clearly labelled test records. Do not point this suite at production. Unit tests cover schema validation, file signatures and fail-closed auth boundaries. Browser tests cover responsive overflow, routes, metadata, project lifecycle, CSRF, session logout and honest failure when storage or Turnstile is absent. Real Access, R2, Turnstile and email delivery require staging verification; local test success is not proof of those integrations.

## Editing your portfolio

- **Projects:** create a draft, enter a unique slug, choose a category and save. Publish when ready. Set Featured to show up to six on the homepage. Numeric display order controls ordering. Technologies are comma-separated. Plain text is rendered safely; HTML is not interpreted.
- **Media:** uploads require a verified reachable R2 binding and MEDIA_MODE=r2. Images/PDFs up to 10 MiB; raster images are compressed in the browser when smaller. GIFs retain animation. Large video is an external HTTPS link, not an embedded third-party player. Attach screenshots to a saved project and set their order/alt text. Upload new files before replacing references; delete unused old files afterwards.
- **About Me:** headline, intro, biography, profile image and service list.
- **Skills / Experience:** editable ordered entries, with no fabricated proficiency ratings or dates.
- **Resume:** upload a PDF, paste its `/media/...pdf` URL, save. `/resume` always redirects to that current file. Empty setting hides navigation links.
- **Messages:** stored contact inquiries, read/archive/delete actions. Notification status differentiates no provider, failed and provider accepted. Acceptance is not confirmed email delivery.
- **Social Links:** unknown URLs stay empty. Enter exact public repository names to showcase. GitHub cache fetches the first 100 most recently updated owner repositories; selection is not a project import or a pinned-repository API.
- **Website Settings:** contact details, SEO and optional Cloudflare Web Analytics token. Refresh browser navigation after changing SEO to inspect server-generated tags.

## Git media fallback (no R2)

Commit optimized raster images and PDFs under `D:\My Portfolio\public\media\`, e.g. `portrait.webp` and `resume.pdf`, build and redeploy. Enter `/media/portrait.webp` or `/media/resume.pdf` in settings. This is a **Git-based file update**, not an admin upload. Galleries currently require R2 metadata entries; the Git fallback supports covers, profile, OG images and resume URLs. Dashboard upload controls stay disabled in Git mode. Never use local filesystem persistence in Workers.

## Architecture and operational boundaries

- `D:\My Portfolio\src\`: responsive public UI and private CMS.
- `D:\My Portfolio\worker\index.ts`: public/admin API, JWT auth, session, R2, GitHub, contact, SEO HTML transformation.
- `D:\My Portfolio\shared\`: types, owner content and Zod schemas.
- `D:\My Portfolio\migrations\`: relational schema plus owner-only seed content.
- `D:\My Portfolio\tests\`: unit/HTTP boundary and Playwright browser tests.
- `D:\My Portfolio\.github\workflows\`: CI and manually triggered approval-gated staging deployment.

See `D:\My Portfolio\docs\DEPLOYMENT.md`, `D:\My Portfolio\docs\SECURITY.md` and `D:\My Portfolio\docs\DELIVERY.md`. No remote resources, Git repository, production migration, billing subscription or deployment are created by installation or local checks.