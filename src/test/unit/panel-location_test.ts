import {describe, expect, test, vi} from 'vite-plus/test';
import {PanelLocation} from '../../panel/panel-location.js';

describe('a deep link', () => {
  test('names a tab', () => {
    const location = new PanelLocation();
    location.apply({tab: 'settings'});
    expect(location.link()).toEqual({tab: 'settings'});
  });

  test('with an element id opens Components unless it named Updates', () => {
    const components = new PanelLocation();
    components.apply({componentId: 3});
    expect(components.tab).toBe('components');
    expect(components.requested('components')).toBe(3);

    const settings = new PanelLocation();
    settings.apply({tab: 'settings', componentId: 3});
    expect(settings.tab).toBe('components');

    const updates = new PanelLocation();
    updates.apply({tab: 'updates', componentId: 3});
    expect(updates.tab).toBe('updates');
    expect(updates.requested('updates')).toBe(3);
    expect(updates.requested('components')).toBeUndefined();
  });

  test('with only an event id opens the timeline on it', () => {
    const location = new PanelLocation();
    location.apply({eventId: 'e-7'});
    expect(location.tab).toBe('timeline');
    expect(location.requested('timeline')).toBe('e-7');
  });

  test('with both ids follows the element', () => {
    const location = new PanelLocation();
    location.apply({componentId: 3, eventId: 'e-7'});
    expect(location.tab).toBe('components');
    expect(location.requested('timeline')).toBeUndefined();
  });
});

describe('a request', () => {
  test('is held, and reported by the link, until the view resolves it', () => {
    const location = new PanelLocation();
    location.apply({eventId: 'e-7'});
    expect(location.selected('timeline')).toBeNull();
    expect(location.link()).toEqual({tab: 'timeline', eventId: 'e-7'});

    location.resolve('timeline', 'e-7');
    expect(location.requested('timeline')).toBeUndefined();
    expect(location.selected('timeline')).toBe('e-7');
  });

  test('a view that cannot find it gives up, clearing the selection', () => {
    const location = new PanelLocation();
    location.select('timeline', 'e-1');
    location.apply({eventId: 'gone'});
    location.resolve('timeline', null);
    expect(location.selected('timeline')).toBeNull();
    expect(location.link()).toEqual({tab: 'timeline'});
  });

  test('a user selection supersedes it', () => {
    const location = new PanelLocation();
    location.apply({tab: 'updates', componentId: 3});
    location.select('updates', 9);
    expect(location.requested('updates')).toBeUndefined();
    // A late resolve for the superseded request changes nothing.
    location.resolve('updates', 3);
    expect(location.selected('updates')).toBe(9);
  });
});

test('each view keeps its own selection', () => {
  const location = new PanelLocation();
  location.select('components', 3);
  location.select('updates', 9);
  expect(location.link()).toEqual({tab: 'components', componentId: 3});
  location.setTab('updates');
  expect(location.link()).toEqual({tab: 'updates', componentId: 9});
  location.setTab('settings');
  expect(location.link()).toEqual({tab: 'settings'});
});

test('tells subscribers about changes, and not about no-ops', () => {
  const location = new PanelLocation();
  const listener = vi.fn();
  location.subscribe(listener);
  location.setTab('components');
  location.select('components', null);
  expect(listener).not.toHaveBeenCalled();
  location.select('components', 3);
  location.setTab('timeline');
  location.resolve('timeline', 'x');
  expect(listener).toHaveBeenCalledTimes(2);
});
