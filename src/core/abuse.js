const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Visitor IP forwarded by Cloudflare; only cloudflared can reach the container, so the header is trusted. */
export function clientIp(request) {
  return request.headers['cf-connecting-ip'] || request.socket.remoteAddress;
}

export function turnstileEnabled(config) {
  return Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET);
}

const TEST_KEY = /^[123]x0{20,}[A-F]{2}$/;
const SECRET_ERRORS = ['invalid-input-secret', 'missing-input-secret'];

export function usesTurnstileTestKeys(config) {
  return [config.TURNSTILE_SITE_KEY, config.TURNSTILE_SECRET].some((key) => key && TEST_KEY.test(key));
}

/**
 * Returns { outcome, status?, codes?, error? } where outcome is 'ok', 'failed' (missing or rejected token),
 * 'misconfigured' (Cloudflare rejected our secret) or 'unreachable' (timeout, network error, 5xx).
 * Details hold only the HTTP status, Cloudflare error codes or the error name - safe to log.
 */
export async function verifyTurnstile({ secret, token, ip, fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!token) return { outcome: 'failed' };
  let res;
  try {
    res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip ?? '' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { outcome: 'unreachable', error: err?.name ?? 'Error' };
  }
  const { status } = res;
  if (status >= 500) return { outcome: 'unreachable', status };
  const body = await res.json().catch(() => ({}));
  const codes = (Array.isArray(body['error-codes']) ? body['error-codes'] : []).filter((c) => /^[a-z-]{1,40}$/.test(c));
  if (status >= 400 || codes.some((c) => SECRET_ERRORS.includes(c))) return { outcome: 'misconfigured', status, codes };
  return body.success === true ? { outcome: 'ok' } : { outcome: 'failed', codes };
}
