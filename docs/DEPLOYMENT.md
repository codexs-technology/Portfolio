# Deployment runbook — explicit owner approval required

## Required inputs / gates

1. Authenticated GitHub access; verify `codexs-technology/mehboob-masih-portfolio`. Public unauthenticated lookup returned HTTP 404 during inspection, which does not exclude a private repository.
2. Approval to create/use that repository and push the reviewed code, on one `main` branch.
3. Cloudflare account ID and least-privilege API token for the approved staging Worker/D1 (and optional R2).
4. Approved staging hostname/zone route, D1 ID and an Access application covering `/admin`, `/admin/*`, `/api/admin/*`, `/api/auth/*`. Use the **same Access application/audience** for these paths.
5. Access team domain, audience, owner email allow policy, Turnstile widget restricted to the staging hostname and its keys.
6. R2 account eligibility and subscription/billing approval **before** activation. Optional email notification API key and verified sender if desired. No email provider is required to store an inquiry.

No staging is deployed until these gates are satisfied. The `.invalid` hostname, all-zero D1 IDs, disabled workers.dev and preview URLs deliberately prevent accidental public deployment. Replace them with verified staging values. Do not copy local tokens to remote secrets.

## Repository verification and approved push

```powershell
Set-Location 'D:\My Portfolio'
gh auth status
gh repo view codexs-technology/mehboob-masih-portfolio --json nameWithOwner,isPrivate,url
# If it exists: inspect permissions/history; do not overwrite or force-push.
# ONLY if absence and creation are verified and approved:
git init -b main
git add .
git diff --cached --stat
# Review for secrets before committing.
git commit -m "Build personal portfolio and Cloudflare CMS"
gh repo create codexs-technology/mehboob-masih-portfolio --private --source . --remote origin
git push -u origin main
```

Choose repository visibility with the owner before creation; the example defaults private. No branch proliferation. No force pushes.

## Staging setup after approval

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
npx.cmd wrangler d1 create portfolio-staging
# Copy the returned database_id into the staging section of wrangler.jsonc.
# Set SITE_URL, ACCESS_TEAM_DOMAIN, ACCESS_AUD and ADMIN_EMAIL in staging vars.
# Add an approved custom domain route to staging; keep workers.dev/preview URLs disabled.
npx.cmd wrangler secret put TURNSTILE_SECRET_KEY --env staging
# TURNSTILE_SITE_KEY is public; configure in staging vars.
npx.cmd wrangler d1 migrations apply portfolio-staging --remote --env staging
npm.cmd run check
npx.cmd wrangler deploy --env staging
```

The commands needing authentication/secrets are intentionally interactive for the owner. Never put credentials in command history or tracked configuration. Use Cloudflare secret bindings for sensitive values.

## Access and domain

Before the deployment, configure Zero Trust Access with an Allow policy for the exact owner email. Confirm the Access audience and issuer. Add all admin/auth paths to one application. Worker-side JOSE verification checks signature, issuer, audience, expiry and owner email on each non-local admin API request. Access must protect the HTML and session-bootstrap paths too. Unconfigured deployments deny access.

Add a Workers custom domain route in the staging environment, e.g. `{ "pattern": "staging.your-owned-domain", "custom_domain": true }`. This is an example, not a configured domain. Confirm zone ownership/DNS and HTTPS. Do not enable a public alternate hostname that bypasses Access. Production requires a separately reviewed environment and approval; it is not preconfigured.

## Optional R2 — no billing activation without approval

Cloudflare's R2 setup requires an R2 subscription; check account eligibility/payment requirements and current allowances in the account. Standard storage currently includes 10 GB-month, 1 million Class A operations and 10 million Class B operations monthly; usage beyond free allowances can be billed. Do not guarantee zero charges or activate automatically.

After explicit approval and account setup:

```powershell
npx.cmd wrangler r2 bucket create portfolio-staging-media
```

Add to `env.staging` in `D:\My Portfolio\wrangler.jsonc`:

```json
"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "portfolio-staging-media" }]
```

Set `MEDIA_MODE` to `r2` only after binding verification. No bucket public URL, R2 credential, presigned credential or CORS policy is required: uploads are same-origin, session-authorized Worker requests. Keep the bucket private. For local upload integration tests, add a local R2 binding explicitly; local emulation does not prove remote persistence.

## GitHub Actions

CI runs on main/PR. Staging workflow is **manual only**, until automation is approved. Create a protected GitHub Environment named `staging`, configure required reviewers and environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Inspect the diff before triggering. After owner approval, add a push trigger on main if desired; no staging branch is necessary. Current workflow applies staging migrations and deploys; it does not assert live verification.

## Free-tier usage / limits

- Workers Free currently permits 100,000 Worker invocations/day, with CPU and subrequest constraints. Page HTML runs through the Worker for SEO. Current configuration runs Worker first for every request, including assets; those invocations count. For higher static traffic, review path-based run_worker_first routing before launch, with an equally strict admin-path guard.
- D1 Free currently includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. Query indexes cover public status/category and relations. Search is a bounded substring scan, not FTS; monitor growth and add FTS if needed.
- GitHub public repo cache refreshes hourly with an atomic refresh lease and stale fallback; upstream rate-limit failures do not become fabricated success. Database rate limits clean up on admin login. Monitor D1 size and schedule retention cleanup if necessary.
- R2 reads/writes, D1 audit writes, contact checks, abuse and cache refreshes consume allowance. Set account notifications and inspect real usage. Free eligibility is not a recurring-cost guarantee.
- No paid SaaS is needed for hosting. Email notification is optional; provider account conditions must be reviewed separately.

## Mandatory live staging checklist

Verify public routes and SEO HTML; real Access sign-in and denial using an unauthorized account; CSRF/session expiry/logout; draft create/edit/publish/unpublish/delete across a fresh browser session; R2 upload/read/replace/reference guard/delete; PDF resume replacement; gallery order/alt text; valid Turnstile inquiry persisted in D1; read/archive/delete; optional email provider response and actual mailbox receipt separately; GitHub failure/stale behavior; keyboard/mobile accessibility and broken links. Record URLs, test dates and evidence in delivery report. Only then request production approval.

Official references (review before rollout):
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/