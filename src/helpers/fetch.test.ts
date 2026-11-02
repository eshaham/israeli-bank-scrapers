import { EventEmitter } from 'events';
import { type IncomingMessage } from 'http';
import https from 'https';
import { PassThrough } from 'stream';
import { fetchPost } from './fetch';
import { TimeoutError } from './waiting';

const URL = 'https://example.com/api';
const CLIENT_CERT = { cert: 'CERT', key: 'KEY' };

function mockFetch(status: number, body: string) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status }));
}

function mockHttpsRequest(status: number, body: string) {
  return jest.spyOn(https, 'request').mockImplementation((_url, _options, callback) => {
    const response = Object.assign(new PassThrough(), { statusCode: status });
    const request = Object.assign(new EventEmitter(), {
      setTimeout: () => request,
      end: () => {
        callback?.(response as unknown as IncomingMessage);
        response.end(body);
      },
    });
    return request as unknown as ReturnType<typeof https.request>;
  });
}

function mockHttpsRequestThatHangs() {
  return jest.spyOn(https, 'request').mockImplementation(() => {
    let onTimeout: (() => void) | undefined;
    const request = Object.assign(new EventEmitter(), {
      setTimeout: (_ms: number, callback: () => void) => {
        onTimeout = callback;
        return request;
      },
      destroy: (error: Error) => request.emit('error', error),
      end: () => onTimeout?.(),
    });
    return request as unknown as ReturnType<typeof https.request>;
  });
}

describe('fetchPost', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should return the parsed JSON response', async () => {
    mockFetch(200, '{"ok":true}');

    await expect(fetchPost(URL, { a: 1 })).resolves.toEqual({ ok: true });
  });

  test('should throw with the status code when the response is not JSON', async () => {
    mockFetch(403, '<!DOCTYPE html>');

    await expect(fetchPost(URL, {})).rejects.toThrow('status code 403');
  });

  test('should include the url when the response is not JSON', async () => {
    mockFetch(403, '<!DOCTYPE html>');

    await expect(fetchPost(URL, {})).rejects.toThrow(URL);
  });

  test('should send the client certificate and Android Conscrypt TLS options through https.request', async () => {
    const request = mockHttpsRequest(200, '{"ok":true}');

    await expect(fetchPost(URL, { a: 1 }, {}, CLIENT_CERT)).resolves.toEqual({ ok: true });

    expect(request).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        method: 'POST',
        cert: 'CERT',
        key: 'KEY',
        requestOCSP: true,
        ecdhCurve: 'X25519:P-256:P-384',
        ALPNProtocols: ['http/1.1'],
      }),
      expect.any(Function),
    );
  });

  test('should throw with the status code when the mTLS response is not JSON', async () => {
    mockHttpsRequest(403, '<!DOCTYPE html>');

    await expect(fetchPost(URL, {}, {}, CLIENT_CERT)).rejects.toThrow('status code 403');
  });

  test('should reject with a TimeoutError when the mTLS request is inactive', async () => {
    mockHttpsRequestThatHangs();

    await expect(fetchPost(URL, {}, {}, CLIENT_CERT)).rejects.toThrow(TimeoutError);
  });
});
