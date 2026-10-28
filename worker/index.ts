import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z, ZodError } from 'zod';
import { defaults, type Project, type Settings } from '../shared/content';
import { contactSchema, entrySchema, projectSchema, safeUrl, mediaUrl, validFile } from '../shared/validation';

export interface Bindings {
  DB: D1Database; ASSETS: Fetcher; MEDIA?: R2Bucket;
  ENVIRONMENT: string; SITE_URL: string; MEDIA_MODE: string;
  LOCAL_ADMIN_TOKEN?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ADMIN_EMAIL?: string;
  TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string; GITHUB_TOKEN?: string;
  EMAIL_API_KEY?: string; EMAIL_FROM?: string; EMAIL_TO?: string;
}
type Env = { Bindings: Bindings; Variables: { admin: string; csrf: string; requestId: string } };
type Ctx = Context<Env>;
const app = new Hono<Env>();
const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(n => n.toString(16).padStart(2, '0')).join('');
const local = (c: Ctx) => c.env.ENVIRONMENT === 'local' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(c.req.url).hostname);
const cookieName = (c: Ctx) => local(c) ? 'portfolio_session' : '__Host-portfolio_session';
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
async function settings(db: D1Database): Promise<Settings> {
  const rows = await db.prepare('SELECT key,value FROM website_settings').all<{ key: string; value: string }>();
  return { ...defaults, ...Object.fromEntries(rows.results.map(r => [r.key, r.value])) };
}
function project(row: Record<string, unknown>): Project {
  return { ...JSON.parse(String(row.data)), id: row.id, slug: row.slug, title: row.title, category: row.category, summary: row.summary, status: row.status, featured: !!row.featured, sortOrder: row.sort_order, updated_at: row.updated_at };
}
async function audit(c: Ctx, action: string, target: string) {
  await c.env.DB.prepare('INSERT INTO audit_logs(id,admin_id,action,target) VALUES(?,?,?,?)').bind(id(), c.get('admin'), action, target).run();
}
async function rate(c: Ctx, kind: string, limit: number, seconds: number) {
  const ip = c.req.header('CF-Connecting-IP') || (local(c) ? 'loopback' : 'unknown');
  const key = await hash(`${kind}:${ip}:${Math.floor(now() / seconds)}`);
  const row = await c.env.DB.prepare('INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(key, now() + seconds).first<{ hits: number }>();
  if (!row || row.hits > limit) fail('Too many requests. Please try again later.', 429);
}
async function json(c: Ctx) {
  if (!c.req.header('Content-Type')?.includes('application/json')) fail('Expected JSON', 415);
  const body = await c.req.text();
  if (body.length > 180000) fail('Request too large', 413);
  try { return JSON.parse(body) as unknown; } catch { return fail('Invalid JSON'); }
}
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function identity(c: Ctx): Promise<string | null> {
  const team = c.env.ACCESS_TEAM_DOMAIN;
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!team || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !c.env.ACCESS_AUD || !token || !c.env.ADMIN_EMAIL) return null;
  try {
    if (!jwks.has(team)) jwks.set(team, createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)));
    const { payload } = await jwtVerify(token, jwks.get(team)!, { issuer: `https://${team}`, audience: c.env.ACCESS_AUD, algorithms: ['RS256'] });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === c.env.ADMIN_EMAIL.toLowerCase() ? payload.email.toLowerCase() : null;
  } catch { return null; }
}
app.use('*', async (c, next) => {
  c.set('requestId', id());
  await next();
  c.header('X-Request-ID', c.get('requestId'));
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (!local(c)) c.header('Strict-Transport-Security', 'max-age=31536000');
  if (c.req.path.startsWith('/api/admin') || c.req.path.startsWith('/api/auth') || c.req.path.startsWith('/admin')) c.header('Cache-Control', 'no-store');
});
app.use('/api/*', bodyLimit({ maxSize: 11 * 1024 * 1024, onError: c => c.json({ error: 'Request too large' }, 413) }));
app.use('/api/*', async (c, next) => {
  const limit = c.req.path === '/api/admin/media/upload' ? 11 * 1024 * 1024 : 200000;
  const length = Number(c.req.header('Content-Length') || 0);
  if (length > limit) return c.json({ error: 'Request too large' }, 413);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin !== new URL(c.req.url).origin) return c.json({ error: 'Invalid request origin' }, 403);
  }
  await next();
});
app.onError((error, c) => {
  if (error instanceof ZodError) return c.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  const status = 'status' in error && typeof error.status === 'number' ? error.status : 500;
  console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), path: c.req.path, status, message: status === 500 ? 'Internal error' : error.message }));
  return c.json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message }, status as 400);
});

app.get('/api/site', async c => {
  const [s, skills, experience, cats] = await Promise.all([
    settings(c.env.DB), c.env.DB.prepare('SELECT id,title,subtitle,body,sort_order AS sortOrder FROM skills ORDER BY sort_order').all(),
    c.env.DB.prepare('SELECT id,title,subtitle,body,sort_order AS sortOrder FROM experience ORDER BY sort_order').all(),
    c.env.DB.prepare('SELECT name FROM project_categories ORDER BY rowid').all<{ name: string }>()
  ]);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ settings: s, skills: skills.results, experience: experience.results, categories: cats.results.map(r => r.name), turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '' });
});
app.get('/api/projects', async c => {
  const page = Math.max(1, Math.min(10000, Number(c.req.query('page')) || 1));
  const q = (c.req.query('q') || '').slice(0, 150);
  const category = (c.req.query('category') || '').slice(0, 100);
  const featured = c.req.query('featured') === 'true';
  const where = "status='published' AND (?='' OR category=?) AND (?='' OR instr(lower(title || ' ' || summary || ' ' || data),lower(?))>0) AND (?=0 OR featured=1)";
  const params = [category, category, q, q, featured ? 1 : 0];
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT * FROM projects WHERE ${where} ORDER BY sort_order,updated_at DESC LIMIT 9 OFFSET ?`).bind(...params, (page - 1) * 9),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM projects WHERE ${where}`).bind(...params)
  ]);
  c.header('Cache-Control', 'public, max-age=30');
  return c.json({ projects: rows.results.map(project), total: Number(total.results[0]?.total || 0), page, pages: Math.ceil(Number(total.results[0]?.total || 0) / 9) });
});
app.get('/api/projects/:slug', async c => {
  const row = await c.env.DB.prepare("SELECT * FROM projects WHERE slug=? AND status='published'").bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Project not found' }, 404);
  const media = await c.env.DB.prepare('SELECT id,url,name,mime,size,alt,sort_order,project_id FROM project_media WHERE project_id=? ORDER BY sort_order').bind(row.id).all();
  const related = await c.env.DB.prepare("SELECT * FROM projects WHERE status='published' AND category=? AND id<>? ORDER BY sort_order LIMIT 3").bind(row.category, row.id).all<Record<string, unknown>>();
  return c.json({ project: { ...project(row), media: media.results }, related: related.results.map(project) });
});

app.post('/api/auth/login', async c => {
  await rate(c, 'login', 8, 900);
  let email = await identity(c);
  if (!email && local(c) && c.env.LOCAL_ADMIN_TOKEN && c.env.LOCAL_ADMIN_TOKEN.length >= 32) {
    const body = z.object({ token: z.string().max(256) }).parse(await json(c));
    if (await hash(body.token) === await hash(c.env.LOCAL_ADMIN_TOKEN)) email = 'local-admin@localhost';
  }
  if (!email) return c.json({ error: 'Verified Cloudflare Access identity required. Configure Access before signing in.' }, 401);
  await c.env.DB.prepare('INSERT INTO admin_users(id,email) VALUES(?,?) ON CONFLICT(email) DO NOTHING').bind(id(), email).run();
  const user = await c.env.DB.prepare('SELECT id FROM admin_users WHERE email=?').bind(email).first<{ id: string }>();
  const token = `${id()}${id()}`; const csrf = id();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
    c.env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now()),
    c.env.DB.prepare('INSERT INTO sessions(id,admin_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await hash(token), user!.id, csrf, now() + 28800)
  ]);
  c.set('admin', user!.id); await audit(c, 'session.login', user!.id);
  setCookie(c, cookieName(c), token, { httpOnly: true, secure: !local(c), sameSite: 'Strict', path: '/', maxAge: 28800 });
  return c.json({ csrf });
});
app.use('/api/admin/*', async (c, next) => {
  // Re-verify Access on every non-local API request, even with an application session.
  const email = local(c) ? null : await identity(c);
  if (!local(c) && !email) return c.json({ error: 'Verified Access identity required' }, 401);
  const token = getCookie(c, cookieName(c));
  if (!token) return c.json({ error: 'Authentication required' }, 401);
  const session = await c.env.DB.prepare('SELECT s.*,u.email FROM sessions s JOIN admin_users u ON u.id=s.admin_id WHERE s.id=? AND s.expires_at>?').bind(await hash(token), now()).first<{ admin_id: string; csrf: string; email: string }>();
  if (!session || (!local(c) && session.email !== email)) return c.json({ error: 'Session expired' }, 401);
  if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header('X-CSRF-Token') !== session.csrf) return c.json({ error: 'Invalid CSRF token' }, 403);
  c.set('admin', session.admin_id); c.set('csrf', session.csrf); await next();
});
app.get('/api/admin/session', c => c.json({ csrf: c.get('csrf') }));
app.post('/api/admin/logout', async c => {
  const token = getCookie(c, cookieName(c));
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(await hash(token)).run();
  deleteCookie(c, cookieName(c), { path: '/', secure: !local(c) });
  return c.json({ ok: true });
});
app.get('/api/admin/overview', async c => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) total,COALESCE(SUM(status='published'),0) published,COALESCE(SUM(status='draft'),0) drafts,COALESCE(SUM(featured),0) featured FROM projects"),
    c.env.DB.prepare('SELECT id,name,project_type,status,created_at FROM contact_submissions ORDER BY created_at DESC LIMIT 5'),
    c.env.DB.prepare('SELECT action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10')
  ]);
  return c.json({ counts: results[0].results[0], messages: results[1].results, updates: results[2].results });
});
app.get('/api/admin/projects', async c => c.json({ projects: (await c.env.DB.prepare('SELECT * FROM projects ORDER BY sort_order,updated_at DESC').all<Record<string, unknown>>()).results.map(project) }));
async function saveProject(c: Ctx, projectId: string, create: boolean) {
  const p = projectSchema.parse(await json(c));
  if (!create && !await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first()) fail('Project not found', 404);
  if (await c.env.DB.prepare('SELECT id FROM projects WHERE slug=? AND id<>?').bind(p.slug, projectId).first()) fail('This slug is already in use', 409);
  if (!await c.env.DB.prepare('SELECT name FROM project_categories WHERE name=?').bind(p.category).first()) fail('Choose an existing category');
  const statements = [create
    ? c.env.DB.prepare('INSERT INTO projects(id,slug,title,category,summary,data,status,featured,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').bind(projectId, p.slug, p.title, p.category, p.summary, JSON.stringify(p), p.status, +p.featured, p.sortOrder)
    : c.env.DB.prepare('UPDATE projects SET slug=?,title=?,category=?,summary=?,data=?,status=?,featured=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(p.slug, p.title, p.category, p.summary, JSON.stringify(p), p.status, +p.featured, p.sortOrder, projectId),
    c.env.DB.prepare('DELETE FROM project_technologies WHERE project_id=?').bind(projectId)
  ];
  for (const technology of [...new Set(p.technologies)]) {
    statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO technologies(name) VALUES(?)').bind(technology));
    statements.push(c.env.DB.prepare('INSERT INTO project_technologies(project_id,technology) VALUES(?,?)').bind(projectId, technology));
  }
  await c.env.DB.batch(statements); await audit(c, create ? 'project.create' : 'project.update', projectId);
  return c.json({ id: projectId, ...p }, create ? 201 : 200);
}
app.post('/api/admin/projects', c => saveProject(c, id(), true));
app.put('/api/admin/projects/:id', c => saveProject(c, c.req.param('id'), false));
app.delete('/api/admin/projects/:id', async c => {
  await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(c.req.param('id')).run();
  await audit(c, 'project.delete', c.req.param('id')); return c.json({ ok: true });
});
app.get('/api/admin/taxonomy', async c => {
  const [cats, tech] = await c.env.DB.batch([c.env.DB.prepare('SELECT name FROM project_categories ORDER BY name'), c.env.DB.prepare('SELECT name FROM technologies ORDER BY name')]);
  return c.json({ categories: cats.results, technologies: tech.results });
});
app.post('/api/admin/taxonomy/:kind', async c => {
  const table = c.req.param('kind') === 'categories' ? 'project_categories' : c.req.param('kind') === 'technologies' ? 'technologies' : fail('Unknown taxonomy');
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await json(c));
  await c.env.DB.prepare(`INSERT OR IGNORE INTO ${table}(name) VALUES(?)`).bind(name).run();
  await audit(c, 'taxonomy.create', name); return c.json({ ok: true });
});
app.delete('/api/admin/taxonomy/:kind/:name', async c => {
  const category = c.req.param('kind') === 'categories';
  if (!category && c.req.param('kind') !== 'technologies') fail('Unknown taxonomy');
  const name = c.req.param('name');
  if (await c.env.DB.prepare(category ? 'SELECT id FROM projects WHERE category=? LIMIT 1' : 'SELECT project_id FROM project_technologies WHERE technology=? LIMIT 1').bind(name).first()) fail('In use by a project. Update the project first.', 409);
  await c.env.DB.prepare(`DELETE FROM ${category ? 'project_categories' : 'technologies'} WHERE name=?`).bind(name).run();
  await audit(c, 'taxonomy.delete', name); return c.json({ ok: true });
});
app.get('/api/admin/settings', async c => c.json(await settings(c.env.DB)));
app.put('/api/admin/settings', async c => {
  const input = z.record(z.string(), z.string().max(30000)).parse(await json(c));
  const allowed = Object.keys(defaults);
  const updates: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) fail(`Unknown setting: ${key}`);
    if (['github', 'linkedin', 'facebook', 'instagram', 'upwork', 'fiverr'].includes(key)) safeUrl.parse(value);
    if (['resume', 'profileImage', 'ogImage'].includes(key)) mediaUrl.parse(value);
    if (key === 'resume' && value && !value.toLowerCase().endsWith('.pdf')) fail('Resume must be a PDF URL');
    if (key === 'email') z.email().parse(value);
    if (key === 'analyticsToken' && value && !/^[a-zA-Z0-9-]{16,80}$/.test(value)) fail('Invalid analytics token');
    updates.push(c.env.DB.prepare('INSERT INTO website_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value));
  }
  if (updates.length) await c.env.DB.batch(updates);
  await audit(c, 'settings.update', Object.keys(input).join(',')); return c.json({ ok: true });
});
app.get('/api/admin/entries/:kind', async c => {
  const kind = c.req.param('kind'); if (!['skills', 'experience'].includes(kind)) fail('Unknown entry type');
  return c.json((await c.env.DB.prepare(`SELECT id,title,subtitle,body,sort_order AS sortOrder FROM ${kind} ORDER BY sort_order`).all()).results);
});
app.post('/api/admin/entries/:kind', async c => {
  const kind = c.req.param('kind'); if (!['skills', 'experience'].includes(kind)) fail('Unknown entry type');
  const p = entrySchema.parse(await json(c)); const key = id();
  await c.env.DB.prepare(`INSERT INTO ${kind}(id,title,subtitle,body,sort_order) VALUES(?,?,?,?,?)`).bind(key, p.title, p.subtitle, p.body, p.sortOrder).run();
  await audit(c, `${kind}.create`, key); return c.json({ id: key, ...p }, 201);
});
app.put('/api/admin/entries/:kind/:id', async c => {
  const kind = c.req.param('kind'); if (!['skills', 'experience'].includes(kind)) fail('Unknown entry type');
  const p = entrySchema.parse(await json(c));
  await c.env.DB.prepare(`UPDATE ${kind} SET title=?,subtitle=?,body=?,sort_order=? WHERE id=?`).bind(p.title, p.subtitle, p.body, p.sortOrder, c.req.param('id')).run();
  await audit(c, `${kind}.update`, c.req.param('id')); return c.json({ ok: true });
});
app.delete('/api/admin/entries/:kind/:id', async c => {
  const kind = c.req.param('kind'); if (!['skills', 'experience'].includes(kind)) fail('Unknown entry type');
  await c.env.DB.prepare(`DELETE FROM ${kind} WHERE id=?`).bind(c.req.param('id')).run();
  await audit(c, `${kind}.delete`, c.req.param('id')); return c.json({ ok: true });
});

async function storageReady(c: Ctx) {
  if (c.env.MEDIA_MODE !== 'r2' || !c.env.MEDIA) return false;
  try { await c.env.MEDIA.head('_health'); return true; } catch { return false; }
}
app.get('/api/admin/media', async c => c.json({ enabled: await storageReady(c), media: (await c.env.DB.prepare('SELECT id,url,name,mime,size,alt,sort_order,project_id FROM project_media ORDER BY created_at DESC').all()).results }));
app.post('/api/admin/media/upload', async c => {
  if (!await storageReady(c)) fail('Persistent R2 storage is not configured or reachable. Use the documented Git-based workflow.', 503);
  await rate(c, 'upload', 30, 3600);
  const data = await c.req.formData(); const file = data.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) fail('Choose an image or PDF up to 10 MiB');
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  if (!extensions[file.type]) fail('Only JPEG, PNG, GIF, WebP and PDF are supported. Use an HTTPS URL for videos.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validFile(bytes, file.type)) fail('File content does not match its type');
  const key = `${id()}.${extensions[file.type]}`; const mediaId = id(); const url = `/media/${key}`;
  const alt = z.string().max(500).parse(String(data.get('alt') || ''));
  await c.env.MEDIA!.put(key, bytes, { httpMetadata: { contentType: file.type } });
  try {
    await c.env.DB.prepare('INSERT INTO project_media(id,object_key,url,name,mime,size,alt) VALUES(?,?,?,?,?,?,?)').bind(mediaId, key, url, file.name.slice(0, 240), file.type, file.size, alt).run();
  } catch (e) { await c.env.MEDIA!.delete(key); throw e; }
  await audit(c, 'media.upload', mediaId); return c.json({ id: mediaId, url }, 201);
});
app.patch('/api/admin/media/:id', async c => {
  const p = z.object({ alt: z.string().max(500), sort_order: z.number().int().min(0).max(100000), project_id: z.string().nullable() }).parse(await json(c));
  await c.env.DB.prepare('UPDATE project_media SET alt=?,sort_order=?,project_id=? WHERE id=?').bind(p.alt, p.sort_order, p.project_id, c.req.param('id')).run();
  await audit(c, 'media.update', c.req.param('id')); return c.json({ ok: true });
});
app.delete('/api/admin/media/:id', async c => {
  const row = await c.env.DB.prepare('SELECT object_key,url FROM project_media WHERE id=?').bind(c.req.param('id')).first<{ object_key: string; url: string }>();
  if (!row) fail('Media not found', 404);
  const refs = await c.env.DB.prepare('SELECT key FROM website_settings WHERE value=? UNION ALL SELECT id AS key FROM projects WHERE instr(data,?)>0 LIMIT 1').bind(row.url, row.url).first();
  if (refs) fail('This file is in use. Replace or remove its content reference first.', 409);
  if (!c.env.MEDIA) fail('Storage unavailable', 503);
  await c.env.MEDIA.delete(row.object_key);
  await c.env.DB.prepare('DELETE FROM project_media WHERE id=?').bind(c.req.param('id')).run();
  await audit(c, 'media.delete', c.req.param('id')); return c.json({ ok: true });
});
app.get('/media/:key', async c => {
  const key = c.req.param('key');
  if (!/^[a-zA-Z0-9-]+\.(jpg|png|gif|webp|pdf)$/.test(key)) return c.notFound();
  const metadata = await c.env.DB.prepare('SELECT mime FROM project_media WHERE object_key=?').bind(key).first<{ mime: string }>();
  if (!metadata || !c.env.MEDIA) return c.env.ASSETS.fetch(c.req.raw);
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, { headers: { 'Content-Type': metadata.mime, 'Cache-Control': 'public,max-age=86400', 'X-Content-Type-Options': 'nosniff', ETag: object.httpEtag, ...(metadata.mime === 'application/pdf' ? { 'Content-Disposition': 'attachment; filename="document.pdf"' } : {}) } });
});
app.get('/resume', async c => {
  const s = await settings(c.env.DB);
  if (!s.resume) return c.text('A resume has not been published yet.', 404);
  mediaUrl.parse(s.resume); return c.redirect(s.resume, 302);
});
app.post('/api/contact', async c => {
  await rate(c, 'contact', 5, 3600);
  const p = contactSchema.parse(await json(c));
  if (!c.env.TURNSTILE_SECRET_KEY) fail('Contact form verification is not configured. Please use email.', 503);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET_KEY, response: p.token, remoteip: c.req.header('CF-Connecting-IP') || '', idempotency_key: id() }), signal: AbortSignal.timeout(8000) });
  const verification = await response.json() as { success: boolean; hostname?: string; action?: string };
  if (!verification.success || verification.action !== 'contact' || verification.hostname !== new URL(c.env.SITE_URL).hostname) fail('Verification failed. Please try again.', 400);
  const key = id();
  await c.env.DB.prepare('INSERT INTO contact_submissions(id,name,email,project_type,budget,message) VALUES(?,?,?,?,?,?)').bind(key, p.name, p.email, p.type, p.budget, p.message).run();
  let notification = 'not_configured';
  if (c.env.EMAIL_API_KEY && c.env.EMAIL_FROM && c.env.EMAIL_TO) {
    try {
      const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${c.env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: c.env.EMAIL_FROM, to: [c.env.EMAIL_TO], reply_to: p.email, subject: 'New portfolio inquiry', text: `Name: ${p.name}\nEmail: ${p.email}\nType: ${p.type}\nBudget: ${p.budget}\n\n${p.message}` }), signal: AbortSignal.timeout(8000) });
      notification = sent.ok ? 'provider_accepted' : 'failed';
    } catch { notification = 'failed'; }
    await c.env.DB.prepare('UPDATE contact_submissions SET notification_status=? WHERE id=?').bind(notification, key).run();
  }
  return c.json({ ok: true, message: 'Your message has been saved. Thank you for getting in touch.', notification }, 201);
});
app.get('/api/admin/messages', async c => c.json((await c.env.DB.prepare('SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 500').all()).results));
app.patch('/api/admin/messages/:id', async c => {
  const { status } = z.object({ status: z.enum(['read', 'archived', 'unread']) }).parse(await json(c));
  await c.env.DB.prepare('UPDATE contact_submissions SET status=? WHERE id=?').bind(status, c.req.param('id')).run();
  await audit(c, 'message.update', c.req.param('id')); return c.json({ ok: true });
});
app.delete('/api/admin/messages/:id', async c => {
  await c.env.DB.prepare('DELETE FROM contact_submissions WHERE id=?').bind(c.req.param('id')).run();
  await audit(c, 'message.delete', c.req.param('id')); return c.json({ ok: true });
});
app.get('/api/github', async c => {
  const cache = await c.env.DB.prepare("SELECT data,expires_at FROM github_cache WHERE key='repos'").first<{ data: string; expires_at: number }>();
  const s = await settings(c.env.DB);
  const selected = s.selectedRepos.split(',').map(n => n.trim()).filter(Boolean);
  const output = (raw: string, stale: boolean) => {
    const repos = JSON.parse(raw) as { name: string }[];
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ repositories: selected.length ? repos.filter(r => selected.includes(r.name)) : [], stale, selectionRequired: !selected.length });
  };
  if (cache && cache.expires_at > now()) return output(cache.data, false);
  // Atomic refresh lease prevents a thundering herd consuming the GitHub API quota.
  const lease = await c.env.DB.prepare("INSERT INTO github_cache(key,data,expires_at) VALUES('lease','[]',?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE github_cache.expires_at<? RETURNING key").bind(now() + 60, now()).first();
  if (!lease) return cache ? output(cache.data, true) : c.json({ repositories: [], error: 'Repository data is refreshing. Please try again.' }, 503);
  try {
    const response = await fetch('https://api.github.com/users/codexs-technology/repos?type=owner&sort=updated&per_page=100', { headers: { 'User-Agent': 'mehboob-masih-portfolio', Accept: 'application/vnd.github+json', ...(c.env.GITHUB_TOKEN ? { Authorization: `Bearer ${c.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('GitHub unavailable');
    const raw = await response.json() as { id: number; name: string; private: boolean; description: string | null; html_url: string; language: string | null; updated_at: string }[];
    if (!Array.isArray(raw)) throw new Error('Invalid repository data');
    const repos = raw.filter(r => r.private === false).map(({ id, name, description, html_url, language, updated_at }) => ({ id, name, description, html_url, language, updated_at }));
    const data = JSON.stringify(repos);
    await c.env.DB.prepare("INSERT INTO github_cache(key,data,expires_at) VALUES('repos',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at").bind(data, now() + 3600).run();
    return output(data, false);
  } catch {
    return cache ? output(cache.data, true) : c.json({ repositories: [], error: 'GitHub is temporarily unavailable. You can still visit the public profile.' }, 503);
  }
});
app.get('/api/admin/github', async c => {
  const row = await c.env.DB.prepare("SELECT data FROM github_cache WHERE key='repos'").first<{ data: string }>();
  return c.json({ repositories: row ? JSON.parse(row.data) : [] });
});

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!);
app.get('/robots.txt', c => c.text(`User-agent: *\n${c.env.ENVIRONMENT === 'staging' ? 'Disallow: /' : 'Allow: /\nDisallow: /admin\nDisallow: /api/admin\nDisallow: /api/auth'}\nSitemap: ${c.env.SITE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', async c => {
  const rows = await c.env.DB.prepare("SELECT slug FROM projects WHERE status='published'").all<{ slug: string }>();
  const paths = ['', '/about', '/projects', '/skills', '/experience', '/contact', ...rows.results.map(r => `/projects/${r.slug}`)];
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${escapeHtml(c.env.SITE_URL + p)}</loc></url>`).join('')}</urlset>`, 200, { 'Content-Type': 'application/xml' });
});
app.all('/api/*', c => c.json({ error: 'API endpoint not found' }, 404));
app.get('*', async c => {
  const path = c.req.path;
  if (path.startsWith('/admin') && !local(c) && !await identity(c)) return c.text('Access denied. A verified Cloudflare Access identity is required.', 401);
  if (/\.[a-zA-Z0-9]+$/.test(path)) return c.env.ASSETS.fetch(c.req.raw);
  const known = ['/', '/about', '/projects', '/skills', '/experience', '/contact'];
  let title = ''; let description = ''; let cover = ''; let missing = false;
  if (path.startsWith('/projects/')) {
    const row = await c.env.DB.prepare("SELECT * FROM projects WHERE slug=? AND status='published'").bind(path.slice(10)).first<Record<string, unknown>>();
    if (row) { const p = project(row); title = `${p.title} — Mehboob Masih`; description = p.summary; cover = p.cover; } else missing = true;
  } else if (!known.includes(path) && !path.startsWith('/admin')) missing = true;
  const s = await settings(c.env.DB);
  title ||= missing ? 'Page not found — Mehboob Masih' : path === '/' ? s.seoTitle : `${path.startsWith('/admin') ? 'Admin' : path.slice(1).replace(/^./, v => v.toUpperCase())} — Mehboob Masih`;
  description ||= s.seoDescription; cover ||= s.ogImage;
  const canonical = c.env.SITE_URL.replace(/\/$/, '') + path;
  const response = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url), { method: 'GET' }));
  const meta = `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(canonical)}"><meta name="twitter:card" content="${cover ? 'summary_large_image' : 'summary'}">${cover ? `<meta property="og:image" content="${escapeHtml(new URL(cover, c.env.SITE_URL).href)}">` : ''}${path.startsWith('/admin') || missing || c.env.ENVIRONMENT === 'staging' ? '<meta name="robots" content="noindex,nofollow">' : ''}`;
  let html = (await response.text()).replace(/<title>.*?<\/title>/s, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `${meta}</head>`);
  // JSON-LD uses inert JSON script content, escaped to prevent closing the script element.
  if (!path.startsWith('/admin')) {
    const schema = { '@context': 'https://schema.org', '@type': 'Person', name: 'Mehboob Masih', url: c.env.SITE_URL, jobTitle: 'Full-Stack Developer | AI Automation Engineer | Software Architect', address: { '@type': 'PostalAddress', addressLocality: 'Karachi', addressCountry: 'PK' }, sameAs: [s.github, s.linkedin, s.upwork, s.fiverr, s.facebook, s.instagram].filter(Boolean) };
    html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script></head>`);
    if (s.analyticsToken) html = html.replace('</body>', `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: s.analyticsToken })}'></script></body>`);
  }
  return c.html(html, missing ? 404 : 200);
});
export default app;