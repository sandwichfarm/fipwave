import { expect, test } from '@playwright/test';

const requestedPort = Number(process.env.FIPWAVE_E2E_PORT ?? '4173');
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) throw new Error('FIPWAVE_E2E_PORT must be a valid unprivileged TCP port');
const origin = `http://127.0.0.1:${requestedPort}`;

test('production origin serves only immutable, allowlisted codec files with fixed MIME and hash identity', async ({ page, request }) => {
  const expected = [
    ['/codec-assets/quiet.js', 'application/javascript'],
    ['/codec-assets/quiet-emscripten.js', 'application/javascript'],
    ['/codec-assets/libfec.js', 'application/javascript'],
    ['/codec-assets/quiet-emscripten.js.mem', 'application/octet-stream'],
    ['/codec-assets/quiet-profiles.json', 'application/json'],
    ['/codec-assets/LICENSE', 'text/plain; charset=utf-8'],
  ] as const;
  for (const [pathname, mime] of expected) {
    const response = await request.get(`${origin}${pathname}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(mime);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['cache-control']).toContain('immutable');
    expect(response.headers()['content-length']).toBe(String((await response.body()).byteLength));
    expect(response.headers().etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);
  }
  for (const pathname of [
    '/codec-assets/cyrinx-ddbd0ce4.tar.gz',
    '/codec-assets/../quiet.js',
    '/codec-assets/%2e%2e%2fquiet.js',
    '/codec-assets/quiet.js?alias=1',
    '/codec-assets/',
    '/codec-assets/nope.js',
  ]) expect((await request.get(`${origin}${pathname}`)).status()).toBe(404);

  const browserRequests: string[] = [];
  page.on('request', (entry) => browserRequests.push(entry.url()));
  await page.goto(`${origin}/`);
  await page.addScriptTag({ url: `${origin}/codec-assets/quiet.js` });
  await page.evaluate(() => {
    const target = window as Window & { Quiet?: { init(options: { profilesPrefix: string; memoryInitializerPrefix: string; libfecPrefix: string; onReady: () => void; onError: (reason: string) => void }): void }; quietInitialization?: string };
    target.quietInitialization = 'pending';
    target.Quiet?.init({
      profilesPrefix: '/codec-assets/', memoryInitializerPrefix: '/codec-assets/', libfecPrefix: '/codec-assets/',
      onReady: () => { target.quietInitialization = 'ready'; },
      onError: (reason) => { target.quietInitialization = `error:${reason}`; },
    });
  });
  await page.addScriptTag({ url: `${origin}/codec-assets/libfec.js` });
  await page.addScriptTag({ url: `${origin}/codec-assets/quiet-emscripten.js` });
  await expect.poll(() => page.evaluate(() => (window as Window & { quietInitialization?: string }).quietInitialization), { timeout: 15_000 }).toBe('ready');
  expect(browserRequests).toEqual(expect.arrayContaining([
    `${origin}/codec-assets/quiet.js`, `${origin}/codec-assets/quiet-emscripten.js`, `${origin}/codec-assets/quiet-emscripten.js.mem`,
    `${origin}/codec-assets/quiet-profiles.json`, `${origin}/codec-assets/libfec.js`,
  ]));
});
