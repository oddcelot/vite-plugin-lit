import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {fromParams, writeHashLink} from '../../panel/deep-link.js';

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
