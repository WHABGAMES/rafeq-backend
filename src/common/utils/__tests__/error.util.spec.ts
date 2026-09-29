import {
  getErrorCode,
  getErrorMessage,
  getHttpErrorDetails,
  hasErrorCode,
  isUniqueConstraintError,
} from '@common/utils/error.util';

describe('error helpers', () => {
  it('extracts messages without assuming the thrown value is an Error', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
    expect(getErrorMessage({ message: 'object failure' })).toBe('object failure');
    expect(getErrorMessage('invalid', 'fallback')).toBe('fallback');
  });

  it('reads database error codes from unknown values', () => {
    expect(getErrorCode({ code: '23505' })).toBe('23505');
    expect(hasErrorCode({ code: 11000 }, '11000')).toBe(true);
    expect(isUniqueConstraintError({ code: '23505' })).toBe(true);
    expect(isUniqueConstraintError(new Error('duplicate'))).toBe(false);
  });

  it('prefers safe provider response fields for HTTP failures', () => {
    expect(getHttpErrorDetails({
      code: 'ERR_BAD_RESPONSE',
      response: { status: 401, data: { error_description: 'token expired', token: 'secret' } },
    })).toEqual({ message: 'token expired', code: 'ERR_BAD_RESPONSE', status: 401 });

    expect(getHttpErrorDetails({ status: 429, message: 'rate limited' })).toEqual({
      message: 'rate limited',
      code: undefined,
      status: 429,
    });
  });
});
