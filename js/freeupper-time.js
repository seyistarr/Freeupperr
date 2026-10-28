// FreeUpper global time handling — device-local display, UTC transport.
// Do not use a device timestamp as an authoritative server event timestamp.
(function (root) {
  'use strict';
  function deviceTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
  }
  function parseTimestamp(value) {
    if (value == null || value === '') return null;
    // Numeric timestamps must explicitly use milliseconds; avoid parsing ambiguous local strings.
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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
  root.FreeUpperTime = Object.freeze({ deviceTimeZone, parseTimestamp, formatLocalTime, formatRelativeTime });
})(typeof window !== 'undefined' ? window : globalThis);
