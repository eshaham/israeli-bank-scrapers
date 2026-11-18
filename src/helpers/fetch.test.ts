import { type Page } from 'puppeteer';
import { fetchPostWithinPage } from './fetch';

describe('fetchPostWithinPage', () => {
  test('parse error does not include request data or headers', async () => {
    const page = { evaluate: jest.fn().mockResolvedValue(['not json', 200]) } as unknown as Page;

    const error = await fetchPostWithinPage(
      page,
      'https://example.com/login',
      { Sisma: 'secret-password' },
      { 'X-XSRF-TOKEN': 'secret-token' },
    ).catch((e: Error) => e);

    expect((error as Error).message).not.toMatch(/secret-password|secret-token/);
  });
});
