# Security model and limitations

## Authentication / authorization

Cloudflare Access is the identity provider. A password database is intentionally not used, so no password KDF is implemented or needed. JOSE verifies RS256 JWT signatures against the configured Access team's cached JWKS and checks issuer/audience/time validity. The exact configured ADMIN_EMAIL is required. Non-local admin HTML and APIs fail closed if Access is missing, even if a session cookie exists. Access team domain is restricted to Cloudflare's domain format; it is not a user-controlled fetch target.

Application sessions use random opaque tokens; only SHA-256 token hashes are in D1. Tokens have eight-hour absolute expiry. Cookies are HttpOnly, SameSite=Strict, Path=/ and Secure with `__Host-` naming outside loopback. No secrets are bundled into React. Production identities are verified again on every admin request. Local development token login requires a generated minimum 32-character secret, ENVIRONMENT=local, and loopback hostname; never deploy local configuration.

State-changing APIs require exact Origin. Authenticated admin mutations additionally require a session-bound CSRF token. Login and contact/upload rate limits are D1-backed, keyed by hashed Cloudflare client IP plus time bucket. Behind Cloudflare, do not forward arbitrary CF-Connecting-IP values from an untrusted proxy. No password brute-force flow exists; login attempts are still limited. Rate-limit rows and expired sessions are pruned on login, not on a scheduled timer.

## Data and rendering

Parameterized SQL, Zod schemas and whitelisted table names prevent SQL injection. React renders user text, never arbitrary HTML. SEO values are HTML-escaped; JSON-LD escapes `<`. Links are restricted to HTTPS or internal `/media/` paths. Browser forms do not evaluate stored HTML/Markdown. CSP, frame denial, nosniff, referrer policy, permissions policy and HTTPS HSTS are set by the Worker. Inline styles are allowed for UI compatibility; scripts remain self/Turnstile/Cloudflare analytics only.

## Uploads

R2 must be configured and reachable before upload controls enable. Session authorization, CSRF and same-origin are required. JPEG/PNG/GIF/WebP/PDF only; size <=10 MiB; magic signatures checked, random immutable keys, no SVG/HTML, no browser R2 secrets. Signatures are not antivirus: PDFs may contain active content; uploaded PDFs are delivered as attachments. Owner should only upload trusted files. Client compression is optimization, not a security boundary. Video is a secure external link, not uploaded persistent local data.

R2 and D1 do not form a distributed transaction. Failed metadata insertion attempts cleanup of newly stored objects; a cleanup failure can leave an orphan requiring bucket reconciliation. File deletion refuses known cover/resume/profile/SEO references, but project deletion deliberately retains library files. New media are publicly retrievable by their unpredictable URL; **do not upload confidential documents**. Project draft data are private, not a promise of private attachment storage.

## Contact / integrations

Turnstile is verified server-side and hostname/action matched. Missing verification fails closed, without silently claiming receipt. Successful inquiries are persisted before optional notifications. Email statuses distinguish accepted/failed/not configured; delivery needs mailbox verification. Never log raw messages, email API keys, cookies, JWTs or tokens. Current structured error logging contains request ID/path/status only; audit records contain admin ID/action/target. Keep contact data only as long as necessary; the owner can delete in the inbox. No automated retention/export policy is supplied.

GitHub uses a public-user-repositories endpoint, filters private=false and projects only safe public fields. Optional token stays server-side. Manual showcase selection does not assert completion or import projects. Upstream failures use stale cache or an explicit unavailable response. First 100 most recently updated public owner repos only.

## Before production

Review dependencies and lockfile; run audit and all checks; configure Access paths and owner policy; verify no alternate public route; configure Turnstile hostname; test actual storage persistence and deletion; back up D1 and media; define retention and abuse monitoring; inspect staging evidence. No compliance certification, security audit, perfect Lighthouse score or zero-cost guarantee is made.