/**
 * Reference consumer for OpenBridge webhooks.
 *
 * Shows the receiver side of the contract:
 *   1. verify the Standard Webhooks signature (rejects forged/replayed calls)
 *   2. de-duplicate on webhook-id (delivery is at-least-once)
 *   3. answer 2xx quickly, process asynchronously
 *
 * Standalone:  WEBHOOK_SECRET=whsec_... PORT=4020 node examples/event-receiver.ts
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CloudEvent } from '../src/events/cloudevents.ts';
import { verifyWebhook } from '../src/events/standard-webhooks.ts';

export interface ReceiverOptions {
  port: number;
  secret: string;
  onEvent?: (ev: CloudEvent) => void;
}

export interface Receiver {
  server: Server;
  url: string;
  received: CloudEvent[];
  rejected: number;
  close(): Promise<void>;
}

export async function startEventReceiver(o: ReceiverOptions): Promise<Receiver> {
  const seen = new Set<string>();
  const state = { received: [] as CloudEvent[], rejected: 0 };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return void res.writeHead(405).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const ok = verifyWebhook(o.secret, {
      id: req.headers['webhook-id'] as string | undefined,
      timestamp: req.headers['webhook-timestamp'] as string | undefined,
      signature: req.headers['webhook-signature'] as string | undefined,
    }, body);
    if (!ok) {
      state.rejected++;
      return void res.writeHead(401).end();
    }
    const id = String(req.headers['webhook-id']);
    res.writeHead(204).end();
    if (seen.has(id)) return;
    seen.add(id);
    const ev = JSON.parse(body) as CloudEvent;
    state.received.push(ev);
    o.onEvent?.(ev);
  });
  await new Promise<void>((r) => server.listen(o.port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  return {
    server,
    url,
    get received() {
      return state.received;
    },
    get rejected() {
      return state.rejected;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('examples/event-receiver.ts')) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('WEBHOOK_SECRET is required');
    process.exit(1);
  }
  const r = await startEventReceiver({
    port: Number(process.env.PORT ?? 4020),
    secret,
    onEvent: (ev) => console.log(`[event] ${ev.type} ${ev.subject ?? ''} ${ev.time}`),
  });
  console.log(`Event receiver listening on ${r.url}`);
}
