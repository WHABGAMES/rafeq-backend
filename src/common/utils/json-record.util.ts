/** A JSON-like object received from a database JSON column or an external webhook. */
export type JsonRecord = Record<string, unknown>;

export function asJsonRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

export function getJsonValue(record: JsonRecord | undefined, ...keys: string[]): unknown {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return undefined;
}

export function getNestedJsonRecord(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  return asJsonRecord(record?.[key]);
}

export function getJsonString(record: JsonRecord | undefined, ...keys: string[]): string | undefined {
  const value = getJsonValue(record, ...keys);
  return typeof value === 'string' ? value : undefined;
}

export function getJsonNumber(record: JsonRecord | undefined, ...keys: string[]): number | undefined {
  const value = getJsonValue(record, ...keys);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getJsonBoolean(record: JsonRecord | undefined, ...keys: string[]): boolean | undefined {
  const value = getJsonValue(record, ...keys);
  return typeof value === 'boolean' ? value : undefined;
}

export function getJsonArray(record: JsonRecord | undefined, ...keys: string[]): unknown[] | undefined {
  const value = getJsonValue(record, ...keys);
  return Array.isArray(value) ? value : undefined;
}

export function getJsonRecordArray(record: JsonRecord | undefined, ...keys: string[]): JsonRecord[] | undefined {
  const values = getJsonArray(record, ...keys);
  if (!values) return undefined;

  const records = values.map(asJsonRecord);
  return records.every((value): value is JsonRecord => value !== undefined)
    ? records
    : undefined;
}
