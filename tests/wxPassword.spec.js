import { describe, it, expect } from 'vitest';
import {
  hashWxPassword,
  verifyWxPassword,
  isBcryptHash,
  legacyMd5WithSalt,
} from '../utils/wxPassword.js';

describe('wxPassword', () => {
  it('hashWxPassword produces bcrypt hash', async () => {
    const hash = await hashWxPassword('secret123');
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyWxPassword('secret123', hash, null)).toBe(true);
    expect(await verifyWxPassword('wrong', hash, null)).toBe(false);
  });

  it('verifyWxPassword supports legacy md5+salt', async () => {
    const salt = 'abcd1234';
    const legacy = legacyMd5WithSalt('passw0rd', salt, 3);
    expect(isBcryptHash(legacy)).toBe(false);
    expect(await verifyWxPassword('passw0rd', legacy, salt)).toBe(true);
    expect(await verifyWxPassword('nope', legacy, salt)).toBe(false);
  });
});
