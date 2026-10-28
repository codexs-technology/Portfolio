import { test, expect } from '@playwright/test';
test('public routes, metadata and responsive boundaries', async ({ page }) => {
  for (const path of ['/', '/about', '/projects', '/skills', '/experience', '/contact']) {
    const response = await page.goto(path); expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(path === '/' ? '/$' : `${path}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('main')).toBeVisible();
  }
});
test('private API, login and persisted project lifecycle', async ({ request, page }) => {
  const token = process.env.LOCAL_ADMIN_TOKEN;
  test.skip(!token, 'Set LOCAL_ADMIN_TOKEN to the same generated value used in .dev.vars.');
  expect((await request.get('/api/admin/projects')).status()).toBe(401);
  const origin = 'http://127.0.0.1:8787';
  const login = await request.post('/api/auth/login', { headers: { Origin: origin }, data: { token } }); expect(login.status()).toBe(200);
  const { csrf } = await login.json(); const headers = { Origin: origin, 'X-CSRF-Token': csrf };
  const slug = `test-only-${Date.now()}`;
  const body = { title: 'TEST ONLY — not professional work', slug, category: 'Web Development', summary: 'Automated lifecycle fixture, deleted by the test.', status: 'draft', technologies: ['TypeScript'] };
  const created = await request.post('/api/admin/projects', { headers, data: body }); expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    expect((await request.get(`/api/projects/${slug}`)).status()).toBe(404);
    expect((await request.put(`/api/admin/projects/${id}`, { headers: { Origin: origin }, data: body })).status()).toBe(403);
    expect((await request.put(`/api/admin/projects/${id}`, { headers, data: { ...body, status: 'published', featured: true } })).status()).toBe(200);
    expect((await request.get(`/api/projects/${slug}`)).status()).toBe(200);
    await page.goto(`/projects/${slug}`); await expect(page.getByRole('heading', { name: body.title })).toBeVisible();
    const secondRead = await request.get('/api/admin/projects'); expect((await secondRead.json()).projects.some((p: { id: string }) => p.id === id)).toBe(true);
    expect((await request.put(`/api/admin/projects/${id}`, { headers, data: { ...body, status: 'draft', title: 'Edited TEST ONLY' } })).status()).toBe(200);
    expect((await request.get(`/api/projects/${slug}`)).status()).toBe(404);
    const media = await request.get('/api/admin/media'); expect((await media.json()).enabled).toBe(false);
    const upload = await request.post('/api/admin/media/upload', { headers, multipart: { file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') } } }); expect(upload.status()).toBe(503);
  } finally { expect((await request.delete(`/api/admin/projects/${id}`, { headers })).status()).toBe(200); }
  expect((await request.get(`/api/projects/${slug}`)).status()).toBe(404);
  await request.post('/api/admin/logout', { headers }); expect((await request.get('/api/admin/session')).status()).toBe(401);
});
test('contact fails honestly when Turnstile is not configured', async ({ request }) => {
  const res = await request.post('/api/contact', { headers: { Origin: 'http://127.0.0.1:8787' }, data: { name: 'Test Only', email: 'test@example.test', type: 'Web Development', budget: '', message: 'This is an automated test message.', token: 'invalid-test-token' } });
  expect([400, 429, 503]).toContain(res.status());
});
test('unknown route has real HTTP 404', async ({ page }) => {
  const response = await page.goto('/not-a-real-page'); expect(response?.status()).toBe(404); await expect(page.getByRole('heading', { name: 'A little off the beaten path.' })).toBeVisible();
});
test('navigation is keyboard reachable and mobile menu works', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});