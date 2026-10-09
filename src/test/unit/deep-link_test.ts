import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {fromParams, linkHref, writeHashLink} from '../../panel/deep-link.js';

const parse = (hash: string) => fromParams(new URLSearchParams(hash));

describe('deep link parsing', () => {
  test('reads an event id alongside the tab', () => {
    expect(parse('tab=timeline&event=lq3x9-42')).toEqual({
      tab: 'timeline',
      eventId: 'lq3x9-42',
    });
  });

  test('ignores an empty event param', () => {
    expect(parse('tab=timeline&event=')).toEqual({tab: 'timeline'});
  });

  test('still reads component ids, including 0', () => {
    expect(parse('tab=components&component=0')).toEqual({
      tab: 'components',
      componentId: 0,
    });
  });
});

describe('range links', () => {
  test('reads start-end milliseconds', () => {
    expect(parse('tab=timeline&range=12.5-340')).toEqual({
      tab: 'timeline',
      range: {start: 12.5, end: 340},
    });
  });

  test('takes either order, and ignores anything else', () => {
    expect(parse('range=9-3').range).toEqual({start: 3, end: 9});
    for (const bad of ['', '5', '5-5', 'a-b', '-1-4', '1e3-4', '1-2-3']) {
      expect(parse(`tab=timeline&range=${bad}`)).toEqual({tab: 'timeline'});
    }
  });

  test('round-trips through the hash, rounded outward to the microsecond', () => {
    vi.stubGlobal('location', {hash: '', pathname: '/__lit/'});
    const replaceState = vi.fn();
    vi.stubGlobal('history', {state: null, replaceState});
    writeHashLink({tab: 'timeline', range: {start: 1.23456, end: 2.00001}});
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '#tab=timeline&range=1.234-2.001'
    );
    vi.unstubAllGlobals();
  });

  test('linkHref points this page at a link, nothing else in the hash', () => {
    vi.stubGlobal('location', {
      origin: 'http://localhost:5173',
      pathname: '/__lit/',
      search: '',
      hash: '#settings&secret=1',
    });
    expect(linkHref({tab: 'timeline', range: {start: 5, end: 7}})).toBe(
      'http://localhost:5173/__lit/#tab=timeline&range=5-7'
    );
    vi.unstubAllGlobals();
  });
});

describe('writing the hash link', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubLocation = (hash: string) => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', {hash, pathname: '/__lit/'});
    vi.stubGlobal('history', {state: null, replaceState});
    return replaceState;
  };

  test('writes the event id', () => {
    const replaceState = stubLocation('');
    writeHashLink({tab: 'timeline', eventId: 'a-1'});
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '#tab=timeline&event=a-1'
    );
  });

  test('drops the event param when nothing is selected', () => {
    const replaceState = stubLocation('#tab=timeline&event=a-1');
    writeHashLink({tab: 'timeline'});
    expect(replaceState).toHaveBeenCalledWith(null, '', '#tab=timeline');
  });
});
