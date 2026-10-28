// How strongly a dependency binds two AL objects, by what it would take to
// cut it. Writing another component's table or extending its objects binds
// hardest; calls and reads can go behind an interface or a codeunit; an event
// subscriber is already loose; a permission set grant is moved, not cut.
// Repeated uses of one kind count logarithmically: ten calls bind more than
// one, but not ten times as much.

export const COUPLING_WEIGHTS = Object.freeze({
  writes: 5,
  extends: 4,
  relates: 3,
  implements: 3,
  calls: 2,
  runs: 2,
  part: 2,
  reads: 2,
  selects: 1.5,
  uses: 1,
  subscribes: 1,
  permits: 0.1,
  includes: 0.1
});

/** Default weights with the overrides of `architecture.couplingWeights`. */
export function couplingWeights(overrides) {
  if (overrides === undefined) return COUPLING_WEIGHTS;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("architecture.couplingWeights must map relation kinds to numbers");
  }
  for (const [kind, value] of Object.entries(overrides)) {
    if (!(kind in COUPLING_WEIGHTS)) throw new Error(`architecture.couplingWeights: unknown relation kind "${kind}"; use ${Object.keys(COUPLING_WEIGHTS).join(", ")}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`architecture.couplingWeights.${kind} must be a number of 0 or more`);
  }
  return Object.freeze({ ...COUPLING_WEIGHTS, ...overrides });
}

/** The coupling of one edge from its relation kinds and their counts. */
export function coupling(kinds, weights = COUPLING_WEIGHTS) {
  let total = 0;
  for (const [kind, count] of Object.entries(kinds ?? {})) {
    if (count > 0) total += (weights[kind] ?? 1) * Math.log2(1 + count);
  }
  return Number(total.toFixed(3));
}
