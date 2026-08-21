import { describe, expect, it } from 'vitest';
import { isAbnChecksumValid, normaliseAbn } from './abn.js';

/**
 * `wellFormed` and `checksumValid` are kept separate on purpose: every ABN in
 * the export is 11 well-spaced digits and every one fails the checksum, because
 * they are invented. Conflating the two would bury the single genuine defect
 * (TerraForm's 7-digit value) under thirteen synthetic ones.
 */

describe('isAbnChecksumValid', () => {
  it('accepts a genuinely valid ABN', () => {
    // 51 824 753 556, the ATO's published example.
    expect(isAbnChecksumValid('51824753556')).toBe(true);
  });

  it('rejects an ABN one digit off a valid one', () => {
    expect(isAbnChecksumValid('51824753557')).toBe(false);
  });

  it('rejects a transposition that keeps the same digits', () => {
    expect(isAbnChecksumValid('51824753565')).toBe(false);
  });

  it.each(['', '1234567890', '123456789012', '5182475355x'])(
    'rejects %s as not eleven digits',
    (digits) => {
      expect(isAbnChecksumValid(digits)).toBe(false);
    },
  );
});

describe('normaliseAbn', () => {
  it('strips the spaces the source writes them with', () => {
    expect(normaliseAbn('51 824 753 556')).toEqual({
      digits: '51824753556',
      present: true,
      wellFormed: true,
      checksumValid: true,
    });
  });

  it('separates a structural defect from a checksum failure', () => {
    // TerraForm's value: present, plainly wrong, and wrong in a way the client
    // can act on. It must not be lumped in with the synthetic-checksum finding.
    const short = normaliseAbn('1234567');
    expect(short.present).toBe(true);
    expect(short.wellFormed).toBe(false);
    expect(short.checksumValid).toBe(false);
  });

  it('reports a well-formed ABN that fails the checksum as exactly that', () => {
    const invented = normaliseAbn('12345678901');
    expect(invented.wellFormed).toBe(true);
    expect(invented.checksumValid).toBe(false);
  });

  it.each([null, undefined, '', '   '])('treats %s as absent, not invalid', (raw) => {
    expect(normaliseAbn(raw)).toEqual({
      digits: null,
      present: false,
      wellFormed: false,
      checksumValid: false,
    });
  });

  it('never claims a checksum is valid for a malformed value', () => {
    for (const raw of ['1', '1234567', '123456789012345']) {
      expect(normaliseAbn(raw).checksumValid).toBe(false);
    }
  });
});
