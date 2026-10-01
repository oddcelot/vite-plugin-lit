import {describe, expect, test} from 'vite-plus/test';
import {createCaptureController} from '../../lib/runtime/timeline/capture.js';
import type {TimelineEvent} from '../../types/timeline.js';

const event: TimelineEvent = {layerId: 'lit-lifecycle', time: 0, data: {}};

const setup = () => {
  const log = {
    emitted: 0,
    pushed: 0,
    resets: 0,
    clockResets: 0,
    renderDebug: [] as boolean[],
  };
  const capture = createCaptureController({
    emit: () => log.emitted++,
    chromeTracks: {push: () => log.pushed++, reset: () => log.resets++},
    setRenderDebug: (on) => log.renderDebug.push(on),
    resetClock: () => log.clockResets++,
  });
  return {capture, log};
};

describe('capture gate', () => {
  test('captures nothing until a consumer asks', () => {
    const {capture, log} = setup();
    expect(capture.capturing()).toBe(false);
    capture.out(event);
    expect(log).toMatchObject({emitted: 0, pushed: 0});
  });

  test('recording sends events to the panel only', () => {
    const {capture, log} = setup();
    capture.setRecording(true);
    expect(capture.capturing()).toBe(true);
    capture.out(event);
    expect(log).toMatchObject({emitted: 1, pushed: 0});
  });

  test('Chrome tracks capture without recording, and get only their copy', () => {
    const {capture, log} = setup();
    capture.setChromeTracks(true);
    expect(capture.capturing()).toBe(true);
    capture.out(event);
    expect(log).toMatchObject({emitted: 0, pushed: 1});
  });

  test('both consumers each get the event', () => {
    const {capture, log} = setup();
    capture.setRecording(true);
    capture.setChromeTracks(true);
    capture.out(event);
    expect(log).toMatchObject({emitted: 1, pushed: 1});
  });

  test('turning Chrome tracks off resets the sink once', () => {
    const {capture, log} = setup();
    capture.setChromeTracks(false);
    expect(log.resets).toBe(0);
    capture.setChromeTracks(true);
    capture.setChromeTracks(false);
    capture.setChromeTracks(false);
    expect(log.resets).toBe(1);
    expect(capture.capturing()).toBe(false);
  });
});

describe('recording edge', () => {
  test('re-zeroes the clock on the rising edge only', () => {
    const {capture, log} = setup();
    capture.setRecording(true);
    capture.setRecording(true);
    expect(log.clockResets).toBe(1);
    capture.setRecording(false);
    expect(log.clockResets).toBe(1);
    capture.setRecording(true);
    expect(log.clockResets).toBe(2);
  });
});

describe('layer flags', () => {
  test('default to lifecycle and render on, the rest off', () => {
    const {enabled} = setup().capture;
    expect([
      enabled.lifecycle(),
      enabled.render(),
      enabled.renderVerbose(),
      enabled.changedValues(),
      enabled.mouse(),
      enabled.keyboard(),
    ]).toEqual([true, true, false, false, false, false]);
  });

  test('follow the panel toggles', () => {
    const {capture} = setup();
    capture.setLayers({mouseEventEnabled: true, litLifecycleEnabled: false});
    expect(capture.enabled.mouse()).toBe(true);
    expect(capture.enabled.lifecycle()).toBe(false);
  });

  test('turn changed values on from the panel', () => {
    const {capture} = setup();
    capture.setLayers({litChangedValuesEnabled: true});
    expect(capture.enabled.changedValues()).toBe(true);
  });
});

describe('render debug flag', () => {
  test('is on only while capturing a render layer', () => {
    const {capture, log} = setup();
    capture.setRecording(true);
    expect(log.renderDebug.at(-1)).toBe(true);
    capture.setLayers({litRenderEnabled: false});
    expect(log.renderDebug.at(-1)).toBe(false);
    capture.setLayers({litRenderVerboseEnabled: true});
    expect(log.renderDebug.at(-1)).toBe(true);
    capture.setRecording(false);
    expect(log.renderDebug.at(-1)).toBe(false);
  });

  test('follows Chrome tracks when not recording', () => {
    const {capture, log} = setup();
    capture.setChromeTracks(true);
    expect(log.renderDebug.at(-1)).toBe(true);
    capture.setChromeTracks(false);
    expect(log.renderDebug.at(-1)).toBe(false);
  });
});
