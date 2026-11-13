/**
 * Authorization model (least privilege, OAuth 2.0 scopes):
 *
 *   bc.read / bc.write                 – all entities
 *   bc.<entitySet>.read / .write       – a single entity set, e.g. bc.customers.read
 *   bc.delete                          – required in addition to write for DELETE
 *   events.read                        – CloudEvents feed
 *   mcp.use                            – Model Context Protocol endpoint
 *   metrics.read                       – Prometheus metrics
 *   admin                              – administrative endpoints
 */
import { HttpError, PROBLEM } from '../http/problem.ts';

export interface Principal {
  /** Stable identifier, e.g. `jwt:<oid>` or `apikey:<id>`. */
  id: string;
  kind: 'jwt' | 'apikey';
  displayName: string;
  scopes: ReadonlySet<string>;
}

export type Access = 'read' | 'write' | 'delete';

export const KNOWN_SCOPES = ['bc.read', 'bc.write', 'bc.delete', 'events.read', 'mcp.use', 'metrics.read', 'admin'];

export function canAccessEntity(p: Principal, entitySet: string, access: Access): boolean {
  if (access === 'delete') {
    return p.scopes.has('bc.delete') && canAccessEntity(p, entitySet, 'write');
  }
  return p.scopes.has(`bc.${access}`) || p.scopes.has(`bc.${entitySet}.${access}`);
}

function insufficient(required: string[]): HttpError {
  return new HttpError(403, 'Forbidden', `Missing required scope: ${required.join(' or ')}.`, {
    type: PROBLEM('insufficient-scope'),
    extras: { requiredScopes: required },
    headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${required.join(' ')}"` },
  });
}

export function requireEntityAccess(p: Principal, entitySet: string, access: Access): void {
  if (canAccessEntity(p, entitySet, access)) return;
  if (access === 'delete') throw insufficient(['bc.delete']);
  throw insufficient([`bc.${access}`, `bc.${entitySet}.${access}`]);
}

export function requireScope(p: Principal, scope: string): void {
  if (!p.scopes.has(scope)) throw insufficient([scope]);
}

/** True if the principal may read at least one entity set. */
export function hasAnyRead(p: Principal): boolean {
  for (const s of p.scopes) if (s === 'bc.read' || /^bc\.[A-Za-z]+\.read$/.test(s)) return true;
  return false;
}
