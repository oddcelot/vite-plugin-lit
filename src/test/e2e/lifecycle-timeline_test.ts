import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {TimelineChannelCodec} from '../../lib/devframe/page-codec.js';
import {fromViteHot} from '../../lib/runtime/page-transport.js';
import type {TimelineEvent} from '../../types/timeline.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

// Regression guard: the lifecycle layer must instrument *every* Lit element via
// the shared base prototype (not just the first registered one, and regardless
// of whether the prod Lit build exposes `reactiveElementVersions`). We record,
// drive an update on the lifecycle demo child, and confirm the phase events
// flow over the `TimelineSource` the panel consumes.
test('lifecycle layer reports update phases over the timeline source', async () => {
  const {page} = fixture;

  // `connect()` must happen before the page (re)connects its HMR client, or the
  // page's `push-event` messages have no listener — the fixture already
  // loaded the page once in `startFixture`, so reload it after connecting.
  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  // Turn recording on (relayed to the page runtime over HMR).
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });

  // Poll: nudge an update on the demo child each round (recording may not be
  // wired on the first tick) until the lifecycle phases show up.
  const titlesSeen = async (): Promise<string[]> => {
    await page.evaluate(() => {
      const child = document
        .querySelector('hmr-lifecycle')
        ?.shadowRoot?.querySelector('hmr-lifecycle-child') as
        | {requestUpdate?: () => void}
        | null
        | undefined;
      child?.requestUpdate?.();
    });
    return events
      .filter((e) => e.layerId === 'lit-lifecycle')
      .map((e) => e.title ?? '');
  };

  await expect
    .poll(async () => (await titlesSeen()).includes('performUpdate:start'), {
      timeout: 10_000,
    })
    .toBe(true);

  const titles = new Set(await titlesSeen());
  // The full update cycle: performUpdate brackets willUpdate, update, updated.
  for (const phase of ['performUpdate', 'willUpdate', 'update', 'updated']) {
    expect(titles.has(`${phase}:start`)).toBe(true);
    expect(titles.has(`${phase}:end`)).toBe(true);
  }
});

// The Changed values layer adds old/new previews to the real update phase, read
// off a real Lit element, and only when it is on.
test('changed values layer records the old and new value of a property', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: true,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });

  const detail = () =>
    events
      .filter((e) => e.title === 'update:start')
      .map((e) => (e.data as {changedDetail?: unknown}).changedDetail)
      .find((d) => d !== undefined);

  // Bump `count` each round: recording may not be wired on the first click.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const child = document
            .querySelector('hmr-lifecycle')
            ?.shadowRoot?.querySelector('hmr-lifecycle-child');
          child?.shadowRoot?.querySelector<HTMLElement>('#increment')?.click();
        });
        return detail();
      },
      {timeout: 10_000}
    )
    .toMatchObject([{key: 'count', sameRef: false, equal: false}]);
});

// Async failures never throw out of a phase, so they only reach the timeline
// through the rejection listener and the task check. Both need the real thing:
// a browser-fired `unhandledrejection` and a real `@lit/task` controller.
test('async updated() rejections and failed tasks are attributed to their element', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: false,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });
  // Recording reaches the page over HMR; wait until updates are recorded.
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          (
            document.querySelector('hmr-task') as {requestUpdate?: () => void}
          )?.requestUpdate?.()
        );
        return events.some((e) => e.title === 'performUpdate:start');
      },
      {timeout: 10_000}
    )
    .toBe(true);

  // A component whose own async updated() rejects after an await. Built off
  // the page's LitElement so it is instrumented like any app component.
  await page.evaluate(() => {
    const Base = Object.getPrototypeOf(customElements.get('hmr-task')!) as {
      new (): HTMLElement;
    };
    class AsyncFail extends Base {
      async updated() {
        null;
        throw new RangeError('late failure');
      }
    }
    customElements.define('e2e-async-fail', AsyncFail);
    document.body.append(document.createElement('e2e-async-fail'));
  });
  await expect
    .poll(() => events.find((e) => e.title === 'updated:rejected'), {
      timeout: 5_000,
    })
    .toMatchObject({
      logType: 'error',
      data: {
        phase: 'updated',
        async: true,
        error: {name: 'RangeError', message: 'late failure'},
      },
      meta: {tagName: 'e2e-async-fail'},
    });

  // The playground's task fetches a user by id; one that does not exist fails.
  await page.evaluate(() => {
    (document.querySelector('hmr-task') as unknown as {userId: number}).userId =
      999;
  });
  await expect
    .poll(() => events.filter((e) => e.title === 'task:error'), {
      timeout: 5_000,
    })
    .toEqual([
      expect.objectContaining({
        logType: 'error',
        data: expect.objectContaining({
          phase: 'task',
          task: 'userTask',
          error: {name: 'Error', message: 'no such user: 999'},
        }),
        meta: expect.objectContaining({tagName: 'hmr-task'}),
      }),
    ]);
});

// A vetoing shouldUpdate is an override on the component, so the base wrappers
// never see it; only a real Lit element proves the runtime still catches it.
test('a component whose shouldUpdate returns false records an update skipped event', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: false,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          (
            document.querySelector('hmr-task') as {requestUpdate?: () => void}
          )?.requestUpdate?.()
        );
        return events.some((e) => e.title === 'performUpdate:start');
      },
      {timeout: 10_000}
    )
    .toBe(true);

  await page.evaluate(() => {
    const Base = Object.getPrototypeOf(customElements.get('hmr-task')!) as {
      new (): HTMLElement;
    };
    class Vetoer extends Base {
      static properties = {count: {type: Number}};
      shouldUpdate() {
        return false;
      }
    }
    customElements.define('e2e-vetoer', Vetoer);
    document.body.append(document.createElement('e2e-vetoer'));
  });
  await page.evaluate(
    "(document.querySelector('e2e-vetoer').count = 5, undefined)"
  );

  await expect
    .poll(
      () =>
        events.find(
          (e) =>
            e.title === 'update skipped' &&
            (e.data as {changed?: string[]}).changed?.includes('count')
        ),
      {
        timeout: 5_000,
      }
    )
    .toMatchObject({
      data: {phase: 'shouldUpdate', changed: ['count']},
      meta: {tagName: 'e2e-vetoer'},
    });
  // The skip sits in the vetoed tick, and that tick rendered nothing.
  const skip = events.find(
    (e) =>
      e.title === 'update skipped' &&
      (e.data as {changed?: string[]}).changed?.includes('count')
  )!;
  const tick = events.filter((e) => e.groupId === skip.groupId);
  expect(tick.map((e) => e.title)).not.toContain('update:start');
});

// The cause of a tick is recorded at the `requestUpdate` an event handler
// makes, found through `window.event`. happy-dom never sets `window.event`,
// so only a real browser shows the mouse layer's mark reaching the wrapper.
test('an update a click handler requests carries that click as its cause', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: false,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: true,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });

  const caused = () =>
    events.find(
      (e) =>
        e.title === 'performUpdate:start' &&
        e.cause?.kind === 'event' &&
        e.cause.layerId === 'mouse'
    );

  // A trusted click, so the browser dispatches it and sets `window.event`.
  // Repeated: recording may not be wired on the first one.
  // A trusted click, so the browser dispatches it through the shadow tree the
  // way a user's would. Repeated: recording may not be wired on the first one,
  // and under load the dep optimizer can reload the page once more after the
  // reload above, which destroys the click's execution context mid-flight.
  await expect
    .poll(
      async () => {
        try {
          await page
            .locator('hmr-lifecycle hmr-lifecycle-child #increment')
            .click({timeout: 2_000});
        } catch {
          return false;
        }
        return caused() !== undefined;
      },
      {timeout: 15_000}
    )
    .toBe(true);

  const tick = caused()!;
  // mouseup and click can share one coarsened time; the cause names which.
  const cause = tick.cause as {layerId: string; time: number; title?: string};
  expect(cause.title).toBe('click');
  const click = events.find(
    (e) =>
      e.layerId === 'mouse' && e.time === cause.time && e.title === cause.title
  );
  expect(click?.title).toBe('click');
  expect(tick.meta?.tagName).toBe('hmr-lifecycle-child');
});

// A `@lit/task` asks for its re-render from a promise continuation, where
// nothing is running to blame. The run is recorded as a span instead, caused
// by the update that started it, and the re-render names the run.
test('a task run started by a click causes the re-render it asks for', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: false,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: true,
    keyboardEventEnabled: false,
    customEventsEnabled: false,
  });

  /** The latest hmr-task run started by an update a click caused. */
  const runFromClick = () => {
    const clicked = new Set(
      events
        .filter(
          (e) =>
            e.title === 'performUpdate:start' &&
            e.meta?.tagName === 'hmr-task' &&
            e.cause?.kind === 'event' &&
            e.cause.layerId === 'mouse'
        )
        .map((e) => String(e.groupId))
    );
    return events
      .filter(
        (e) =>
          e.title === 'task:start' &&
          e.meta?.tagName === 'hmr-task' &&
          e.cause?.kind === 'update' &&
          clicked.has(e.cause.groupId)
      )
      .at(-1);
  };

  // Clicked until one lands while recording (see the click-cause test above
  // for the reload this retries through). Stops at the first hit: another
  // click would supersede the run before its fake fetch settles.
  await expect
    .poll(
      async () => {
        try {
          await page.locator('hmr-task #next-user').click({timeout: 2_000});
        } catch {
          return false;
        }
        return runFromClick() !== undefined;
      },
      {timeout: 15_000}
    )
    .toBe(true);

  const run = runFromClick()!;
  expect(run.data).toMatchObject({phase: 'task', task: 'userTask'});
  const rerender = () =>
    events.find(
      (e) =>
        e.title === 'performUpdate:start' &&
        e.meta?.tagName === 'hmr-task' &&
        e.cause?.kind === 'task' &&
        e.cause.groupId === run.groupId
    );
  await expect
    .poll(() => rerender() !== undefined, {timeout: 10_000})
    .toBe(true);
  expect(rerender()!.time).toBeGreaterThan(run.time);
  await expect
    .poll(
      () =>
        events.find((e) => e.title === 'task:end' && e.groupId === run.groupId)
          ?.data,
      {timeout: 5_000}
    )
    .toMatchObject({status: 'complete'});
});
