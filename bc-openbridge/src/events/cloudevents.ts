/**
 * CloudEvents 1.0 (CNCF) – vendor-neutral event envelope.
 * Business Central change notifications are normalised into CloudEvents so
 * that any broker (Kafka, NATS, Azure Event Grid, Knative, AWS EventBridge …)
 * or webhook consumer can process them without BC-specific code.
 */
import { createHash } from 'node:crypto';
import { formatTraceparent, type TraceContext } from '../observability/trace.ts';

export interface CloudEvent<T = unknown> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject?: string;
  time: string;
  datacontenttype: 'application/json';
  dataschema?: string;
  /** CloudEvents Distributed Tracing extension */
  traceparent?: string;
  data: T;
}

/** Notification payload as sent by Business Central webhooks. */
export interface BcNotification {
  subscriptionId: string;
  clientState?: string;
  expirationDateTime?: string;
  resource: string;
  changeType: 'created' | 'updated' | 'deleted' | 'collection' | string;
  lastModifiedDateTime?: string;
}

export interface BcChangeData {
  companyId: string;
  entitySet: string;
  id?: string;
  changeType: string;
  lastModifiedDateTime?: string;
  /** Link to the record on this gateway (thin event – fetch for details). */
  href?: string;
}

const RESOURCE = /(?:^|\/)api\/(.+?)\/companies\(([0-9a-f-]{36})\)\/([A-Za-z0-9]+)(?:\(([0-9a-f-]{36})\))?$/i;

export function parseBcResource(resource: string): { apiRoute: string; companyId: string; entitySet: string; id?: string } | null {
  const m = RESOURCE.exec(resource.trim());
  if (!m) return null;
  return { apiRoute: m[1], companyId: m[2].toLowerCase(), entitySet: m[3], id: m[4]?.toLowerCase() };
}

export interface EventContext {
  typePrefix: string;
  environment: string;
  publicBaseUrl: string;
  trace?: TraceContext;
}

export function toCloudEvent(n: BcNotification, ctx: EventContext): CloudEvent<BcChangeData> | null {
  const r = parseBcResource(n.resource);
  if (!r) return null;
  const changeType = /^[a-z]+$/i.test(n.changeType) ? n.changeType.toLowerCase() : 'unknown';
  const id = createHash('sha256')
    .update([n.subscriptionId, n.resource, changeType, n.lastModifiedDateTime ?? ''].join('|'))
    .digest('hex')
    .slice(0, 32);
  return {
    specversion: '1.0',
    id,
    source: `/businesscentral/${ctx.environment}/companies/${r.companyId}`,
    type: `${ctx.typePrefix}.${r.entitySet}.${changeType}`,
    subject: r.id ? `${r.entitySet}/${r.id}` : r.entitySet,
    time: n.lastModifiedDateTime && !Number.isNaN(Date.parse(n.lastModifiedDateTime)) ? new Date(n.lastModifiedDateTime).toISOString() : new Date().toISOString(),
    datacontenttype: 'application/json',
    ...(ctx.trace ? { traceparent: formatTraceparent(ctx.trace) } : {}),
    data: {
      companyId: r.companyId,
      entitySet: r.entitySet,
      ...(r.id ? { id: r.id } : {}),
      changeType,
      ...(n.lastModifiedDateTime ? { lastModifiedDateTime: n.lastModifiedDateTime } : {}),
      href: r.id
        ? `${ctx.publicBaseUrl}/v1/companies/${r.companyId}/${r.entitySet}/${r.id}`
        : `${ctx.publicBaseUrl}/v1/companies/${r.companyId}/${r.entitySet}`,
    },
  };
}
