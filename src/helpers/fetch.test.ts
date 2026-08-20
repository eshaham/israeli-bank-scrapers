import { type Page } from 'puppeteer';
import { fetchPostWithinPage } from './fetch';

function createPageReturning(responseText: string, status = 200): Page {
  return {
    evaluate: jest.fn().mockResolvedValue([responseText, status]),
  } as unknown as Page;
}

describe('fetchPostWithinPage', () => {
  test('does not leak request body or header values when the response is not valid JSON', async () => {
    const page = createPageReturning('<html>not json</html>');

    let message: string | undefined;
    try {
      await fetchPostWithinPage(
        page,
        'https://bank.example/login',
        { password: 'secret-password', username: 'sensitive-user' },
        { Authorization: 'secret-token' },
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBeDefined();
    expect(message).not.toContain('secret-password');
    expect(message).not.toContain('sensitive-user');
    expect(message).not.toContain('secret-token');
    expect(message).toContain('password');
    expect(message).toContain('username');
    expect(message).toContain('Authorization');
  });

  test('reports Cloudflare HTML as an automation block instead of a JSON parse error', async () => {
    const page = createPageReturning(
      '<!DOCTYPE html><title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>',
      403,
    );

    await expect(
      fetchPostWithinPage(page, 'https://bank.example/login', { username: 'sensitive-user' }),
    ).rejects.toThrow('Automation detected and blocked by server');
  });
});
