/**
 * RFC 9457 – Problem Details for HTTP APIs.
 * Every error leaving the gateway (REST, webhooks, admin) uses this format.
 */
export type ProblemExtras = Record<string, unknown>;

export interface HttpErrorOptions {
  type?: string;
  extras?: ProblemExtras;
  headers?: Record<string, string>;
}

export const PROBLEM = (slug: string) => `urn:openbridge:problem:${slug}`;

export class HttpError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly type: string;
  readonly extras: ProblemExtras;
  readonly headers: Record<string, string>;

  constructor(status: number, title: string, detail?: string, opts: HttpErrorOptions = {}) {
    super(detail ?? title);
    this.name = 'HttpError';
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = opts.type ?? 'about:blank';
    this.extras = opts.extras ?? {};
    this.headers = opts.headers ?? {};
  }

  toProblem(instance?: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...this.extras,
    };
  }
}

export interface FieldError {
  field: string;
  message: string;
}

export const errors = {
  badRequest: (detail: string, extras?: ProblemExtras) =>
    new HttpError(400, 'Bad Request', detail, { type: PROBLEM('bad-request'), extras }),
  validation: (errs: FieldError[]) =>
    new HttpError(400, 'Validation failed', 'The request body or query contains invalid values.', {
      type: PROBLEM('validation'),
      extras: { errors: errs },
    }),
  notFound: (detail = 'Resource not found') => new HttpError(404, 'Not Found', detail, { type: PROBLEM('not-found') }),
  forbidden: (detail: string, extras?: ProblemExtras, headers?: Record<string, string>) =>
    new HttpError(403, 'Forbidden', detail, { type: PROBLEM('forbidden'), extras, headers }),
  methodNotAllowed: (allow: string[]) =>
    new HttpError(405, 'Method Not Allowed', undefined, { headers: { Allow: allow.join(', ') } }),
  unsupportedMediaType: (expected: string[]) =>
    new HttpError(415, 'Unsupported Media Type', `Expected one of: ${expected.join(', ')}`, {
      type: PROBLEM('unsupported-media-type'),
    }),
  preconditionRequired: () =>
    new HttpError(428, 'Precondition Required', 'Send an If-Match header containing the ETag of the resource.', {
      type: PROBLEM('precondition-required'),
    }),
  internal: () => new HttpError(500, 'Internal Server Error', 'An unexpected error occurred.'),
};
