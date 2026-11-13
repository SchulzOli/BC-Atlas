/**
 * Standard Webhooks (https://www.standardwebhooks.com) – open specification for
 * signing webhook payloads, so receivers can verify authenticity and reject
 * replays with any off-the-shelf library.
 *
 *   webhook-id:         unique message id (idempotency key for receivers)
 *   webhook-timestamp:  unix seconds
 *   webhook-signature:  v1,<base64(HMAC-SHA256(secret, id.timestamp.body))>
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function secretKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

export function signWebhook(secret: string, msgId: string, timestamp: number, payload: string): string {
  const mac = createHmac('sha256', secretKey(secret)).update(`${msgId}.${timestamp}.${payload}`).digest('base64');
  return `v1,${mac}`;
}

export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export function verifyWebhook(
  secret: string,
  h: WebhookHeaders,
  payload: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > toleranceSec) return false;
  const expected = Buffer.from(signWebhook(secret, h.id, ts, payload).slice(3), 'base64');
  return h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
