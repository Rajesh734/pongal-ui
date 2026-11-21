const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Visitor IP forwarded by Cloudflare; only cloudflared can reach the container, so the header is trusted. */
export function clientIp(request) {
  return request.headers['cf-connecting-ip'] || request.socket.remoteAddress;
}

export function turnstileEnabled(config) {
  return Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET);
}

/** Returns 'ok', 'failed' (missing or rejected token) or 'unreachable' (timeout or network error). */
export async function verifyTurnstile({ secret, token, ip, fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!token) return 'failed';
  let res;
  try {
    res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip ?? '' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return 'unreachable';
  }
  if (!res.ok) return 'unreachable';
  const body = await res.json().catch(() => ({}));
  return body.success === true ? 'ok' : 'failed';
}
