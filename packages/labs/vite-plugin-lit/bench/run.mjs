/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * CSS-delivery benchmark runner.
 *
 * Serves the harness over HTTP (generating the synthetic utility sheet on the
 * fly), then drives each variant × component-count in a real Chrome via
 * playwright-core. For each run it captures a DevTools timeline trace (open it
 * in DevTools ▸ Performance ▸ "Load profile") and the in-page metrics, writes
 * everything under `results/`, and prints a summary table.
 *
 * Usage:
 *   node bench/run.mjs                      # defaults
 *   node bench/run.mjs --n 50,200,500 --classes 300 --variants link,style,adopted,inline
 *   BENCH_HEADED=1 node bench/run.mjs       # watch the browser
 *   BENCH_CHROME=/path/to/chrome node bench/run.mjs
 *   node bench/run.mjs --serve --port 5180  # just serve the harness (for the
 *                                           # Chrome DevTools MCP), stay alive
 *
 * Requires a Chrome/Chromium (uses the `chrome` channel by default; override
 * with BENCH_CHROME, e.g. after `npx playwright install chromium`).
 */

import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as path from 'node:path';
import {chromium} from 'playwright-core';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(BENCH_DIR, 'results');

const parseArgs = () => {
  const out = {
    variants: ['link', 'style', 'adopted', 'inline'],
    n: [50, 200, 500],
    classes: 300,
    serve: false,
    port: 5180,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--serve') {
      out.serve = true;
      continue;
    }
    const val = argv[++i];
    if (flag === '--variants') out.variants = val.split(',');
    else if (flag === '--n') out.n = val.split(',').map(Number);
    else if (flag === '--classes') out.classes = Number(val);
    else if (flag === '--port') out.port = Number(val);
  }
  return out;
};

/** Synthetic utility sheet — ~3 rules per "class group", simple selectors. */
const genCss = (groups) => {
  let css = '';
  for (let i = 0; i < groups; i++) {
    const hue = (i * 37) % 360;
    css +=
      `.u-bg-${i}{background:hsl(${hue} 70% 50%);}` +
      `.u-text-${i}{color:hsl(${hue} 60% 40%);}` +
      `.u-p-${i}{padding:${i % 16}px;}\n`;
  }
  return css;
};

const startServer = async (listenPort = 0) => {
  const html = await readFile(path.join(BENCH_DIR, 'index.html'));
  const harness = await readFile(path.join(BENCH_DIR, 'harness.js'));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/util.css') {
      const groups = Number(url.searchParams.get('classes') ?? '300');
      res.writeHead(200, {'content-type': 'text/css'});
      res.end(genCss(groups));
    } else if (url.pathname === '/harness.js') {
      res.writeHead(200, {'content-type': 'text/javascript'});
      res.end(harness);
    } else {
      res.writeHead(200, {'content-type': 'text/html'});
      res.end(html);
    }
  });
  await new Promise((r) => server.listen(listenPort, '127.0.0.1', r));
  const {port} = server.address();
  return {server, origin: `http://127.0.0.1:${port}`};
};

// DevTools timeline events whose self-time we attribute to CSS work.
const TRACED = {
  ParseAuthorStyleSheet: 'parseCssMs',
  UpdateLayoutTree: 'recalcStyleMs', // style recalc in current Chrome
  RecalculateStyles: 'recalcStyleMs', // older alias
  Layout: 'layoutMs',
};

const summarizeTrace = (events) => {
  const totals = {parseCssMs: 0, recalcStyleMs: 0, layoutMs: 0};
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const key = TRACED[e.name];
    if (key) totals[key] += e.dur / 1000; // µs → ms
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
  return totals;
};

const runOne = async (browser, origin, variant, n, classes) => {
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  const events = [];
  client.on('Tracing.dataCollected', (d) => events.push(...d.value));
  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories:
      'disabled-by-default-devtools.timeline,blink,blink.user_timing,v8,toplevel',
  });

  await page.goto(`${origin}/?variant=${variant}&n=${n}&classes=${classes}`);
  await page.waitForFunction(() => window.__bench !== undefined, {
    timeout: 30_000,
  });
  const metrics = await page.evaluate(() => window.__bench);

  await new Promise((res) => {
    client.once('Tracing.tracingComplete', res);
    client.send('Tracing.end');
  });
  await page.close();

  const traceName = `trace-${variant}-n${n}-c${classes}.json`;
  await writeFile(
    path.join(RESULTS_DIR, traceName),
    JSON.stringify({traceEvents: events})
  );

  return {...metrics, ...summarizeTrace(events), trace: traceName};
};

const main = async () => {
  const {variants, n: counts, classes, serve, port} = parseArgs();

  if (serve) {
    const {origin} = await startServer(port);
    const ex = `${origin}/?variant=adopted&n=500&classes=600`;
    console.log(`bench harness serving at ${origin}`);
    console.log(`example: ${ex}`);
    console.log('variants: link | style | adopted | inline   (Ctrl-C to stop)');
    return; // stay alive; do not launch a browser
  }

  await mkdir(RESULTS_DIR, {recursive: true});
  const {server, origin} = await startServer();

  const exec = process.env.BENCH_CHROME;
  const browser = await chromium.launch({
    ...(exec ? {executablePath: exec} : {channel: 'chrome'}),
    headless: process.env.BENCH_HEADED === undefined,
  });

  const rows = [];
  for (const n of counts) {
    for (const variant of variants) {
      process.stdout.write(`running ${variant} × ${n}… `);
      const row = await runOne(browser, origin, variant, n, classes);
      rows.push(row);
      console.log(
        `${row.distinctSheets} sheets, recalc ${row.recalcStyleMs}ms, parse ${row.parseCssMs}ms, fouc ${row.foucMs}ms`
      );
    }
  }

  await browser.close();
  server.close();

  await writeFile(
    path.join(RESULTS_DIR, 'summary.json'),
    JSON.stringify(rows, null, 2)
  );

  // Compact console table.
  console.log('\n=== summary ===');
  console.table(
    rows.map((r) => ({
      variant: r.variant,
      n: r.n,
      sheets: r.distinctSheets,
      'parse(ms)': r.parseCssMs,
      'recalc(ms)': r.recalcStyleMs,
      'layout(ms)': r.layoutMs,
      'mount(ms)': r.mountMs,
      'fouc(ms)': r.foucMs,
      'cssKB': Math.round(r.cssBytes / 102.4) / 10,
      'heap(MB)': r.heapBytes ? Math.round(r.heapBytes / 1e5) / 10 : null,
    }))
  );
  console.log(`\ntraces + summary.json written to ${RESULTS_DIR}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
