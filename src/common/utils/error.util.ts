import { asJsonRecord, getJsonString, getNestedJsonRecord } from './json-record.util';

export interface SafeErrorDetails {
  message: string;
  code?: string;
  status?: number;
}

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) return error.message;
  return getJsonString(asJsonRecord(error), 'message') ?? fallback;
}

export function getErrorCode(error: unknown): string | undefined {
  const code = asJsonRecord(error)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  const code = getErrorCode(error);
  return code !== undefined && codes.includes(code);
}

export function getHttpErrorDetails(error: unknown, fallback = 'External request failed'): SafeErrorDetails {
  const errorRecord = asJsonRecord(error);
  const response = getNestedJsonRecord(errorRecord, 'response');
  const responseData = asJsonRecord(response?.data);
  const statusValue = response?.status ?? errorRecord?.status;
  const status = typeof statusValue === 'number' && Number.isInteger(statusValue)
    ? statusValue
    : undefined;

  const message = getJsonString(responseData, 'message', 'error_description', 'error')
    ?? getErrorMessage(error, fallback);

  return {
    message,
    code: getErrorCode(error),
    status,
  };
}

export function isUniqueConstraintError(error: unknown): boolean {
  return hasErrorCode(error, '23505');
}
