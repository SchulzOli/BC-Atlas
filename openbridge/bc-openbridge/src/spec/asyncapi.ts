/**
 * AsyncAPI 3.0 document describing the event side of the gateway
 * (CloudEvents delivered via signed webhooks or the polling feed).
 */
import type { EntityDef } from '../bc/entities.ts';
import { CLOUD_EVENT_SCHEMA, pascal, type Schema } from './schemas.ts';

export function buildAsyncApi(o: { entities: Record<string, EntityDef>; version: string; typePrefix: string }): Schema {
  const channels: Schema = {};
  const operations: Schema = {};
  const messages: Schema = {};
  const changeTypes = ['created', 'updated', 'deleted', 'collection'];

  for (const e of Object.values(o.entities).filter((x) => x.webhooks)) {
    const channelMessages: Schema = {};
    for (const ct of changeTypes) {
      const id = `${e.singular}${pascal(ct)}`;
      messages[id] = {
        name: `${o.typePrefix}.${e.name}.${ct}`,
        title: `${e.singular} ${ct}`,
        contentType: 'application/cloudevents+json',
        headers: {
          type: 'object',
          properties: {
            'webhook-id': { type: 'string' },
            'webhook-timestamp': { type: 'string' },
            'webhook-signature': { type: 'string' },
          },
        },
        payload: {
          allOf: [CLOUD_EVENT_SCHEMA, { type: 'object', properties: { type: { const: `${o.typePrefix}.${e.name}.${ct}` } } }],
        },
      };
      channelMessages[id] = { $ref: `#/components/messages/${id}` };
    }
    channels[e.name] = {
      address: `${o.typePrefix}.${e.name}`,
      title: `${e.description} – change events`,
      messages: channelMessages,
    };
    operations[`publish${pascal(e.name)}Changes`] = {
      action: 'send',
      channel: { $ref: `#/channels/${e.name}` },
      summary: `Gateway emits a CloudEvent whenever a ${e.singular} changes in Business Central`,
    };
  }

  return {
    asyncapi: '3.0.0',
    info: {
      title: 'BC OpenBridge Events',
      version: o.version,
      description:
        'Business Central change notifications normalised to CloudEvents 1.0. Delivered as HTTP webhooks signed per ' +
        'Standard Webhooks (HMAC-SHA256) or retrievable via GET /v1/events.',
    },
    defaultContentType: 'application/cloudevents+json',
    servers: {
      subscriber: { host: '{subscriberHost}', protocol: 'https', description: 'Your webhook endpoint', variables: { subscriberHost: { default: 'example.com' } } },
    },
    channels,
    operations,
    components: { messages },
  };
}
