/**
 * Tiny Prometheus/OpenMetrics text exposition – no dependencies.
 */
type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return '{' + keys.map((k) => `${k}="${esc(labels[k])}"`).join(',') + '}';
}

export class Counter {
  readonly name: string;
  readonly help: string;
  readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}${k} ${v}`);
    return lines.join('\n');
  }
}

export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  readonly series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(name: string, help: string, buckets: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(labels: Labels, value: number): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i]++;
    });
    s.sum += value;
    s.count++;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) => {
        lines.push(`${this.name}_bucket${labelKey({ ...s.labels, le: String(b) })} ${s.counts[i]}`);
      });
      lines.push(`${this.name}_bucket${labelKey({ ...s.labels, le: '+Inf' })} ${s.count}`);
      lines.push(`${this.name}_sum${labelKey(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${labelKey(s.labels)} ${s.count}`);
    }
    return lines.join('\n');
  }
}

const LATENCY = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Metrics {
  readonly httpRequests = new Counter('openbridge_http_requests_total', 'HTTP requests handled by the gateway');
  readonly httpDuration = new Histogram('openbridge_http_request_duration_seconds', 'Gateway request latency', LATENCY);
  readonly bcRequests = new Counter('openbridge_bc_requests_total', 'Requests sent to Business Central');
  readonly bcDuration = new Histogram('openbridge_bc_request_duration_seconds', 'Business Central request latency', LATENCY);
  readonly authFailures = new Counter('openbridge_auth_failures_total', 'Failed authentication attempts');
  readonly rateLimited = new Counter('openbridge_rate_limited_total', 'Requests rejected by rate limiting');
  readonly eventsReceived = new Counter('openbridge_events_received_total', 'Change notifications received from Business Central');
  readonly webhookDeliveries = new Counter('openbridge_webhook_deliveries_total', 'Outbound webhook delivery attempts');

  render(): string {
    return (
      [
        this.httpRequests,
        this.httpDuration,
        this.bcRequests,
        this.bcDuration,
        this.authFailures,
        this.rateLimited,
        this.eventsReceived,
        this.webhookDeliveries,
      ]
        .map((m) => m.render())
        .join('\n') + '\n'
    );
  }
}
