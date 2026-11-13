import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTITIES } from '../src/bc/entities.ts';
import { buildFilter, buildOrderBy, buildSelect, parseListQuery } from '../src/bc/odata.ts';
import { HttpError } from '../src/http/problem.ts';
import { parseFilter } from '../src/mock/bc-mock.ts';

const customers = ENTITIES.customers;

describe('OData filter builder', () => {
  it('builds typed, escaped expressions', () => {
    const f = buildFilter(customers, [
      { field: 'displayName', op: 'eq', value: "O'Brien" },
      { field: 'balanceDue', op: 'gt', value: '100.5' },
      { field: 'city', op: 'startswith', value: 'Ber' },
      { field: 'taxLiable', op: 'eq', value: 'true' },
      { field: 'lastModifiedDateTime', op: 'ge', value: '2026-01-01T00:00:00Z' },
    ]);
    assert.equal(
      f,
      "displayName eq 'O''Brien' and balanceDue gt 100.5 and startswith(city,'Ber') and taxLiable eq true and lastModifiedDateTime ge 2026-01-01T00:00:00Z",
    );
  });

  it('neutralises OData injection attempts', () => {
    const f = buildFilter(customers, [{ field: 'displayName', op: 'eq', value: "x' or 1 eq 1 or displayName eq '" }]);
    // the whole payload stays inside one string literal
    const pred = parseFilter(f!);
    assert.equal(pred({ displayName: 'anything' }), false);
    assert.equal(pred({ displayName: "x' or 1 eq 1 or displayName eq '" }), true);
  });

  it('rejects injection through numeric fields', () => {
    assert.throws(() => buildFilter(customers, [{ field: 'balanceDue', op: 'gt', value: '0 or 1 eq 1' }]), HttpError);
  });

  it('rejects unknown fields, operators and type mismatches', () => {
    assert.throws(() => buildFilter(customers, [{ field: 'secretField', op: 'eq', value: 'a' }]), { title: 'Validation failed' });
    assert.throws(() => buildFilter(customers, [{ field: 'city', op: 'regex' as never, value: 'a' }]), HttpError);
    assert.throws(() => buildFilter(customers, [{ field: 'balanceDue', op: 'contains', value: '1' }]), HttpError);
    assert.throws(() => buildFilter(customers, [{ field: 'paymentTermsId', op: 'eq', value: 'not-a-guid' }]), HttpError);
    assert.throws(() => buildFilter(ENTITIES.salesOrders, [{ field: 'orderDate', op: 'eq', value: '2026-13-45' }]), HttpError);
    assert.throws(() => buildFilter(customers, [{ field: 'type', op: 'eq', value: 'Robot' }]), { title: 'Validation failed' });
    assert.throws(() => buildFilter(customers, [{ field: 'city', op: 'eq', value: 'a\u0000b' }]), HttpError);
  });

  it('limits the number of clauses', () => {
    const many = Array.from({ length: 11 }, () => ({ field: 'city', op: 'eq' as const, value: 'x' }));
    assert.throws(() => buildFilter(customers, many), /At most/);
  });

  it('builds $select (always incl. id) and $orderby', () => {
    assert.equal(buildSelect(customers, ['displayName', 'city']), 'id,displayName,city');
    assert.throws(() => buildSelect(customers, ['password']), HttpError);
    assert.equal(buildOrderBy(customers, [{ field: 'balanceDue', desc: true }, { field: 'number', desc: false }]), 'balanceDue desc,number asc');
  });

  it('parses REST query parameters strictly', () => {
    const q = parseListQuery(new URLSearchParams('filter.city=Berlin&filter.balanceDue.gt=10&select=number&sort=-balanceDue&limit=5'));
    assert.deepEqual(q.filters, [
      { field: 'city', op: 'eq', value: 'Berlin' },
      { field: 'balanceDue', op: 'gt', value: '10' },
    ]);
    assert.equal(q.limit, 5);
    assert.deepEqual(q.sort, [{ field: 'balanceDue', desc: true }]);
    assert.throws(() => parseListQuery(new URLSearchParams('$filter=1 eq 1')), { title: 'Validation failed' });
    assert.throws(() => parseListQuery(new URLSearchParams('limit=100000')), { title: 'Validation failed' });
  });
});
