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
