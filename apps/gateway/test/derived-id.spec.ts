import { deriveUuidV4 } from '../src/application/derived-id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deriveUuidV4', () => {
  it('is a function of its inputs and a valid v4 UUID', () => {
    const a = deriveUuidV4('secret', 'label', 'customer', 'key');

    expect(a).toBe(deriveUuidV4('secret', 'label', 'customer', 'key'));
    expect(a).toMatch(V4);
  });

  it('changes with the secret, the label and every part', () => {
    const base = deriveUuidV4('secret', 'label', 'customer', 'key');

    expect(deriveUuidV4('other', 'label', 'customer', 'key')).not.toBe(base);
    expect(deriveUuidV4('secret', 'other', 'customer', 'key')).not.toBe(base);
    expect(deriveUuidV4('secret', 'label', 'other', 'key')).not.toBe(base);
    expect(deriveUuidV4('secret', 'label', 'customer', 'other')).not.toBe(base);
  });

  it('does not let the boundary between parts slide', () => {
    expect(deriveUuidV4('s', 'l', 'ab', 'c')).not.toBe(deriveUuidV4('s', 'l', 'a', 'bc'));
  });

  it('keeps the v4 shape over many inputs', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(deriveUuidV4('secret', 'label', String(index))).toMatch(V4);
    }
  });
});
