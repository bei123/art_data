import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveWespaceBasicAuthorization,
  resolveExternalBearerAuthorization,
} from '../utils/externalApiAuth.js';

describe('externalApiAuth', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.VERIFICATION_CODE_AUTHORIZATION;
    delete process.env.EXTERNAL_BEARER_TOKEN;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('resolveWespaceBasicAuthorization prefers x-external-authorization', () => {
    const req = {
      headers: {
        'x-external-authorization': 'Basic from-header',
        authorization: 'Basic other',
      },
    };
    expect(resolveWespaceBasicAuthorization(req)).toBe('Basic from-header');
  });

  it('resolveWespaceBasicAuthorization falls back to env', () => {
    process.env.VERIFICATION_CODE_AUTHORIZATION = 'Basic from-env';
    expect(resolveWespaceBasicAuthorization({ headers: {} })).toBe('Basic from-env');
    expect(resolveWespaceBasicAuthorization()).toBe('Basic from-env');
  });

  it('resolveWespaceBasicAuthorization returns null when unset', () => {
    expect(resolveWespaceBasicAuthorization({ headers: {} })).toBe(null);
  });

  it('resolveExternalBearerAuthorization normalizes token', () => {
    process.env.EXTERNAL_BEARER_TOKEN = 'abc.def.ghi';
    expect(resolveExternalBearerAuthorization()).toBe('Bearer abc.def.ghi');
  });

  it('resolveExternalBearerAuthorization keeps Bearer prefix', () => {
    process.env.EXTERNAL_BEARER_TOKEN = 'Bearer already';
    expect(resolveExternalBearerAuthorization()).toBe('Bearer already');
  });

  it('resolveExternalBearerAuthorization returns null when unset', () => {
    expect(resolveExternalBearerAuthorization()).toBe(null);
  });
});
