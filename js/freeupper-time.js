// FreeUpper global time handling — device-local display, UTC transport.
// Do not use a device timestamp as an authoritative server event timestamp.
(function (root) {
  'use strict';
  function deviceTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
  }
  function parseTimestamp(value) {
    if (value == null || value === '') return null;
    // Event strings must identify an instant. Never guess a viewer-local offset
    // for a legacy timestamp without one; date-only values (such as DOB) are not events.
    if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
    // Numeric timestamps explicitly use milliseconds.
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // Compare local calendar dates, not 24-hour periods: DST days can be 23/25 hours.
  function localDayDifference(value, now) {
    const date = parseTimestamp(value);
    const today = parseTimestamp(now == null ? Date.now() : now);
    if (!date || !today) return null;
    const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return (day(today) - day(date)) / 86400000;
  }
  function formatLocalTime(value, options) {
    const date = parseTimestamp(value);
    if (!date) return '';
    return new Intl.DateTimeFormat(undefined, options || {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(date);
  }
  function formatRelativeTime(value, now) {
    const date = parseTimestamp(value);
    if (!date) return '';
    const seconds = Math.round((date.getTime() - (now == null ? Date.now() : now)) / 1000);
    const abs = Math.abs(seconds);
    const unit = abs < 60 ? 'second' : abs < 3600 ? 'minute' : abs < 86400 ? 'hour' : 'day';
    const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400;
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
  }
  root.FreeUpperTime = Object.freeze({ deviceTimeZone, parseTimestamp, localDayDifference, formatLocalTime, formatRelativeTime });
})(typeof window !== 'undefined' ? window : globalThis);
