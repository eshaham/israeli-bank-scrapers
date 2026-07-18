import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Android OkHttp 4.x TLS cipher suite order.
 * Node.js's built-in fetch uses a different TLS fingerprint (JA3) that Cloudflare
 * bot-management blocks on some Israeli bank APIs (e.g. One Zero / tfd-bank.com).
 * Using undici with this cipher order produces a fingerprint that matches the
 * mobile apps these APIs were designed for.
 */
const ANDROID_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const ANDROID_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512',
].join(':');

const mobileAgent = new Agent({
  connect: {
    ciphers: ANDROID_CIPHERS,
    sigalgs: ANDROID_SIGALGS,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
  },
});

const MOBILE_HEADERS = {
  'User-Agent': 'okhttp/4.10.0',
  'Accept-Encoding': 'gzip',
  Connection: 'Keep-Alive',
};

export async function mobileFetchPost<TResult = any>(
  url: string,
  data: Record<string, any>,
  extraHeaders: Record<string, any> = {},
): Promise<TResult> {
  const response = await undiciFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...MOBILE_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(data),
    dispatcher: mobileAgent,
  });
  return response.json() as Promise<TResult>;
}

export async function mobileFetchGraphql<TResult>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, any> = {},
): Promise<TResult> {
  const result = await mobileFetchPost<{ data: TResult; errors?: { message: string }[] }>(
    url,
    { operationName: null, query, variables },
    extraHeaders,
  );
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  return result.data;
}
