import {expect, test} from 'vite-plus/test';
import {callSiteOf, metaOf} from '../../lib/runtime/timeline/identity.js';

test('callSiteOf reads the stamped attribute with its column', () => {
  const el = document.createElement('x-a');
  expect(callSiteOf(el)).toBeUndefined();
  el.setAttribute('data-lit-source', 'C:/app/src/page.ts:12:5');
  expect(callSiteOf(el)).toEqual({
    file: 'C:/app/src/page.ts',
    line: 12,
    column: 5,
  });
  // A malformed value is no call site.
  el.setAttribute('data-lit-source', 'nope');
  expect(callSiteOf(el)).toBeUndefined();
});

test('callSiteOf ignores things that are not elements', () => {
  expect(callSiteOf({})).toBeUndefined();
});

test('metaOf adds the call site only when there is one', () => {
  const el = document.createElement('x-b');
  expect(metaOf(el)).not.toHaveProperty('callSite');
  el.setAttribute('data-lit-source', 'src/app.ts:3:9');
  expect(metaOf(el)).toMatchObject({
    tagName: 'x-b',
    callSite: {file: 'src/app.ts', line: 3, column: 9},
  });
});
