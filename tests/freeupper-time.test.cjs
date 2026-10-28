// Run: node --test tests/freeupper-time.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const source = readFileSync(resolve(__dirname, '../js/freeupper-time.js'), 'utf8');
function load() {
  const window = {};
  runInNewContext(source, { window, Intl, Date });
  return window.FreeUpperTime;
}
test('invalid timestamps render empty', () => {
  const time = load();
  assert.equal(time.formatLocalTime('not-a-date'), '');
  assert.equal(time.formatLocalTime(null), '');
  assert.equal(time.parseTimestamp('not-a-date'), null);
});
test('UTC instant remains identical across time zones and DST', () => {
  const instant = '2026-10-28T12:00:00Z';
  for (const [zone, expected] of [
    ['Africa/Lagos', '13:00'],
    ['Europe/London', '12:00'],
    ['America/New_York', '08:00'],
    ['Asia/Tokyo', '21:00']
  ]) {
    const actual = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(instant));
    assert.equal(actual, expected, zone);
  }
  const format = date => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23'
  }).format(new Date(date));
  assert.equal(format('2026-01-15T12:00:00Z'), '07');
  assert.equal(format('2026-07-15T12:00:00Z'), '08');
});
test('device local formatting follows runtime TZ without user override', () => {
  const script = `global.window={}; eval(require('node:fs').readFileSync('js/freeupper-time.js','utf8'));
    process.stdout.write(window.FreeUpperTime.deviceTimeZone()+'|'+window.FreeUpperTime.formatLocalTime('2026-10-28T12:00:00Z',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));`;
  const lagos = execFileSync(process.execPath, ['-e', script], { cwd: resolve(__dirname, '..'), env: { ...process.env, TZ: 'Africa/Lagos' }, encoding: 'utf8' });
  const tokyo = execFileSync(process.execPath, ['-e', script], { cwd: resolve(__dirname, '..'), env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' });
  assert.equal(lagos, 'Africa/Lagos|13:00');
  assert.equal(tokyo, 'Asia/Tokyo|21:00');
});

test('event parsing requires explicit offsets and preserves the instant', () => {
  const time = load();
  for (const invalid of [true, {}, [], '2026-10-28', '2026-10-28T12:00:00', '10/28/2026 12:00']) {
    assert.equal(time.parseTimestamp(invalid), null, String(invalid));
  }
  for (const input of ['2026-10-28T12:00:00Z', '2026-10-28T13:00:00+01:00', '2026-10-28 21:00:00+0900']) {
    assert.equal(time.parseTimestamp(input).toISOString(), '2026-10-28T12:00:00.000Z');
  }
  assert.equal(time.parseTimestamp(0).getTime(), 0);
});

test('device formatting and local calendar days follow both DST transitions', () => {
  const cases = [
    ['Africa/Lagos', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '01:30', '02:30'],
    ['Asia/Tokyo', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '09:30', '10:30'],
    ['Europe/London', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '00:30', '02:30'],
    ['Europe/London', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '01:30', '01:30'],
    ['America/New_York', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', '01:30', '03:30'],
    ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '01:30', '01:30']
  ];
  for (const [zone, before, after, first, second] of cases) {
    const script = `global.window={}; eval(require('node:fs').readFileSync('js/freeupper-time.js','utf8'));
      const t=window.FreeUpperTime, options={hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
      process.stdout.write(JSON.stringify([t.formatLocalTime('${before}',options),t.formatLocalTime('${after}',options),t.localDayDifference('${before}','${after}')]));`;
    const result = execFileSync(process.execPath, ['-e', script], { cwd: resolve(__dirname, '..'), env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(result), [first, second, 0], zone);
  }
  for (const [zone, before, after] of [
    ['Europe/London', '2026-03-28T23:30:00Z', '2026-03-29T22:30:00Z'],
    ['Europe/London', '2026-10-24T22:30:00Z', '2026-10-25T23:30:00Z'],
    ['America/New_York', '2026-03-08T04:30:00Z', '2026-03-09T03:30:00Z'],
    ['America/New_York', '2026-11-01T03:30:00Z', '2026-11-02T04:30:00Z']
  ]) {
    const script = `global.window={}; eval(require('node:fs').readFileSync('js/freeupper-time.js','utf8')); process.stdout.write(String(window.FreeUpperTime.localDayDifference('${before}','${after}')));`;
    assert.equal(execFileSync(process.execPath, ['-e', script], { cwd: resolve(__dirname, '..'), env: { ...process.env, TZ: zone }, encoding: 'utf8' }), '1', zone);
  }
});

test('notification grouping uses viewer calendar dates over 23/25-hour days', () => {
  const originalZone = process.env.TZ;
  const notifications = readFileSync(resolve(__dirname, '../notification.js'), 'utf8');
  const bucket = notifications.match(/    function dateBucket\(iso\) \{[\s\S]*?\n    \}/)[0];
  try {
    for (const [zone, now, yesterday] of [
      ['Europe/London', '2026-03-29T22:30:00Z', '2026-03-28T23:30:00Z'],
      ['Europe/London', '2026-10-25T23:30:00Z', '2026-10-24T22:30:00Z'],
      ['America/New_York', '2026-03-09T03:30:00Z', '2026-03-08T04:30:00Z'],
      ['America/New_York', '2026-11-02T04:30:00Z', '2026-11-01T03:30:00Z']
    ]) {
      process.env.TZ = zone;
      class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return Date.parse(now); }
      }
      const context = { window: {}, Intl, Date: Clock };
      runInNewContext(source, context);
      assert.equal(runInNewContext(bucket + `;dateBucket('${yesterday}')`, context), 'Yesterday', zone);
      assert.equal(runInNewContext(`dateBucket('${now}')`, context), 'Today', zone);
      assert.equal(runInNewContext("dateBucket(null)", context), 'Earlier');
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test('timestamp entrypoints load the shared helper before their consumers', () => {
  for (const page of ['index', 'video', 'chat', 'notification', 'search', 'sound']) {
    const html = readFileSync(resolve(__dirname, `../${page}.html`), 'utf8');
    const helper = html.indexOf('src="/js/freeupper-time.js"');
    assert.ok(helper >= 0, page);
    const consumer = html.indexOf(`src="${page}.js"`) >= 0 ? html.indexOf(`src="${page}.js"`) : html.indexOf(`src="/${page}.js"`);
    if (consumer >= 0) assert.ok(helper < consumer, page);
  }
});
