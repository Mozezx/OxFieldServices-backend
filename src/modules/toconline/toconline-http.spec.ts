import { unwrapDataArray } from './toconline-http';

describe('unwrapDataArray', () => {
  it('returns array when data is array', () => {
    expect(unwrapDataArray({ data: [{ id: '1' }] })).toEqual([{ id: '1' }]);
  });

  it('wraps single data object', () => {
    expect(unwrapDataArray({ data: { id: '2' } })).toEqual([{ id: '2' }]);
  });

  it('returns empty for invalid', () => {
    expect(unwrapDataArray(null)).toEqual([]);
  });
});
