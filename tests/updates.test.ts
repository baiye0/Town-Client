import { expect, it } from 'vitest';
import { UpdateChecker } from '../desktop/updates';
const release = (tag = 'v0.2.0') => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: 'Town-Client.zip' }] });
it('compares semantic versions and constructs release links from the trusted repository', async () => {
  const checker = new UpdateChecker('0.1.9', 'baiye0/Town-Client', (async (url, options) => {
    expect(url).toBe('https://api.github.com/repos/baiye0/Town-Client/releases/latest');
    expect(options?.redirect).toBe('error');
    return Response.json({ ...release('v0.1.10'), html_url: 'https://evil.invalid' });
  }) as typeof fetch);
  expect(await checker.check()).toMatchObject({ phase: 'available', latestVersion: '0.1.10', releaseUrl: 'https://github.com/baiye0/Town-Client/releases/tag/v0.1.10' });
});
it('handles private/missing releases without claiming that the installed version is current', async () => {
  const checker = new UpdateChecker('0.1.1', 'baiye0/Town-Client', (async () => new Response('', { status: 404 })) as typeof fetch);
  expect((await checker.check()).phase).toBe('unavailable');
});
it('ignores older, incomplete and prerelease releases and bounds metadata', async () => {
  for (const metadata of [release('v0.1.0'), { ...release(), assets: [] }, { ...release(), prerelease: true }, { ...release(), body: 'x'.repeat(260000) }]) {
    const checker = new UpdateChecker('0.1.1', 'baiye0/Town-Client', (async () => Response.json(metadata)) as typeof fetch);
    expect((await checker.check()).phase).toBe(metadata.tag_name === 'v0.1.0' ? 'current' : 'unavailable');
  }
});
it('coalesces overlapping manual and automatic checks', async () => {
  let resolve!: (response: Response) => void; let count = 0;
  const checker = new UpdateChecker('0.1.1', 'baiye0/Town-Client', (() => { count++; return new Promise<Response>(r => { resolve = r; }); }) as typeof fetch);
  const a = checker.check(), b = checker.check();
  resolve(Response.json(release()));
  await Promise.all([a, b]); expect(count).toBe(1);
});
