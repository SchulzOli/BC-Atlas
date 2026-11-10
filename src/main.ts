import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { logger } from './observability/log.ts';
import { VERSION } from './version.ts';

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    process.stderr.write(`${e.message}\n\nSee .env.example for all options.\n`);
    process.exit(1);
  }
  throw e;
}

const app = createApp(config);
const url = await app.listen();
app.subscriptions.start();
logger.info('BC OpenBridge started', {
  version: VERSION,
  url,
  publicBaseUrl: config.publicBaseUrl,
  environment: config.bc.environment,
  oidc: !!config.oidc,
  apiKeys: config.apiKeys.length,
  mcp: config.mcp.enabled,
  subscribe: config.bc.subscribe,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await app.close();
    process.exit(0);
  });
}
