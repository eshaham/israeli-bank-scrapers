import { type Page } from 'puppeteer';
import { fetchPostWithinPage } from './fetch';

function createPageReturning(responseText: string): Page {
  return {
    evaluate: jest.fn().mockResolvedValue(responseText),
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
        { Sisma: 'superSecretPass', username: 'someUser' },
        { Authorization: 'Bearer leakmetoken' },
      );
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toBeDefined();
    // credential/secret values must never appear in the error message
    expect(message).not.toContain('superSecretPass');
    expect(message).not.toContain('leakmetoken');
    // field names are kept for diagnostics
    expect(message).toContain('Sisma');
    expect(message).toContain('Authorization');
  });
});
