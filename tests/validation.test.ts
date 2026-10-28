import { describe, expect, it } from 'vitest';
import { projectSchema, contactSchema, safeUrl, mediaUrl, validFile } from '../shared/validation';
import app, { type Bindings } from '../worker/index';

describe('project validation', () => {
  const base = { title: 'Real owner project', slug: 'real-owner-project', category: 'Web Development', summary: 'Owner supplied summary' };
  it('defaults to private draft', () => { expect(projectSchema.parse(base).status).toBe('draft'); });
  it('rejects unsafe slugs and script URLs', () => {
    expect(projectSchema.safeParse({ ...base, slug: '../admin' }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, github: 'javascript:alert(1)' }).success).toBe(false);
  });
  it('validates tags and display order', () => {
    expect(projectSchema.safeParse({ ...base, technologies: [''], sortOrder: -1 }).success).toBe(false);
  });
  it('hides optional content by keeping empty values', () => {
    const p = projectSchema.parse(base); expect(p.results).toBe(''); expect(p.completionDate).toBe('');
  });
});
describe('URLs and contact data', () => {
  it('permits HTTPS and internal media, not protocol-relative paths', () => {
    expect(safeUrl.safeParse('https://github.com/codexs-technology').success).toBe(true);
    for (const s of ['javascript:alert(1)', '//evil.test', 'http://example.com']) expect(safeUrl.safeParse(s).success).toBe(false);
    expect(mediaUrl.safeParse('/media/resume.pdf').success).toBe(true);
    expect(mediaUrl.safeParse('/admin').success).toBe(false);
  });
  it('rejects short messages and missing verification', () => {
    expect(contactSchema.safeParse({ name: 'Mehboob', email: 'bad', type: 'Web', message: 'hi', token: '' }).success).toBe(false);
  });
});
describe('file content validation', () => {
  it('accepts valid signatures', () => {
    expect(validFile(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).toBe(true);
    expect(validFile(new TextEncoder().encode('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(validFile(new TextEncoder().encode('GIF89a'), 'image/gif')).toBe(true);
  });
  it('rejects active content, SVGs and MIME spoofing', () => {
    const payload = new TextEncoder().encode('<script>alert(1)</script>');
    expect(validFile(payload, 'image/png')).toBe(false);
    expect(validFile(payload, 'image/svg+xml')).toBe(false);
  });
});
describe('fail-closed HTTP boundaries', () => {
  const env = { ENVIRONMENT: 'staging', SITE_URL: 'https://staging.example.test' } as Bindings;
  it('rejects unauthenticated admin API without touching D1', async () => {
    const res = await app.request('/api/admin/projects', {}, env); expect(res.status).toBe(401);
  });
  it('rejects admin HTML without Access', async () => {
    const res = await app.request('/admin', {}, env); expect(res.status).toBe(401);
  });
  it('rejects forged Access header without configured verification', async () => {
    const res = await app.request('/api/admin/session', { headers: { 'Cf-Access-Jwt-Assertion': 'forged' } }, env); expect(res.status).toBe(401);
  });
  it('rejects cross-origin mutation', async () => {
    const res = await app.request('/api/admin/projects', { method: 'POST', headers: { Origin: 'https://evil.test' } }, env); expect(res.status).toBe(403);
  });
  it('returns JSON 404 rather than app HTML for unknown API routes', async () => {
    const res = await app.request('/api/unknown', {}, env); expect(res.status).toBe(404); expect(res.headers.get('Content-Type')).toContain('application/json');
  });
  it('sets security headers', async () => {
    const res = await app.request('/api/admin/projects', {}, env);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});