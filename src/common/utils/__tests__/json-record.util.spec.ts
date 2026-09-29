import {
  asJsonRecord,
  getJsonArray,
  getJsonBoolean,
  getJsonNumber,
  getJsonRecordArray,
  getJsonString,
  getJsonValue,
  getNestedJsonRecord,
} from '@common/utils/json-record.util';

describe('JSON record helpers', () => {
  it('accepts plain JSON objects and rejects arrays or primitives', () => {
    expect(asJsonRecord({ id: 1 })).toEqual({ id: 1 });
    expect(asJsonRecord([])).toBeUndefined();
    expect(asJsonRecord('value')).toBeUndefined();
    expect(asJsonRecord(null)).toBeUndefined();
  });

  it('returns the first meaningful value from compatible field names', () => {
    expect(getJsonValue({ snake_case: 'legacy', camelCase: 'current' }, 'camelCase', 'snake_case')).toBe('current');
    expect(getJsonValue({ camelCase: '', snake_case: 'legacy' }, 'camelCase', 'snake_case')).toBe('legacy');
  });

  it('reads nested records without trusting unknown input', () => {
    const metadata = asJsonRecord({ shipment: { delivery_date: '2026-09-28' } });
    expect(getNestedJsonRecord(metadata, 'shipment')).toEqual({ delivery_date: '2026-09-28' });
    expect(getNestedJsonRecord(asJsonRecord({ shipment: 'invalid' }), 'shipment')).toBeUndefined();
  });

  it('reads primitive values only when their runtime type matches', () => {
    const record = asJsonRecord({ name: 'Rafeq', count: 3, active: false, invalid: '3' });
    expect(getJsonString(record, 'name')).toBe('Rafeq');
    expect(getJsonNumber(record, 'count')).toBe(3);
    expect(getJsonBoolean(record, 'active')).toBe(false);
    expect(getJsonNumber(record, 'invalid')).toBeUndefined();
  });

  it('validates arrays before exposing them as records', () => {
    expect(getJsonArray({ items: [1, 'two'] }, 'items')).toEqual([1, 'two']);
    expect(getJsonRecordArray({ items: [{ id: 1 }, { id: 2 }] }, 'items')).toHaveLength(2);
    expect(getJsonRecordArray({ items: [{ id: 1 }, 'invalid'] }, 'items')).toBeUndefined();
  });
});
