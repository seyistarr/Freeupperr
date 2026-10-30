// Profile identities and retained views are scoped to the authenticated viewer.
// Aliases are lookup hints only; every entry is owned by an immutable user ID.
(function(root) {
    'use strict';
    root.createProfileCache = function(options) {
        options = options || {};
        var limit = options.limit || 20, ttl = options.ttl || 60000;
        var entries = new Map(), pending = new Map(), viewer, generation = 0;
        function scope(next) {
            if (next === viewer) return;
            viewer = next; generation++; entries.clear(); pending.clear();
        }
        function get(id) {
            var entry = entries.get(id);
            if (entry) { entries.delete(id); entries.set(id, entry); }
            return entry;
        }
        function put(profile, complete) {
            if (!profile || !profile.id) return null;
            var entry = get(profile.id) || { profile: {}, loadedAt: 0 };
            // Modal seeds must never overwrite a previously resolved identity.
            entry.profile = complete ? Object.assign({}, profile) : Object.assign({}, profile, entry.profile);
            if (complete) entry.loadedAt = Date.now();
            entries.set(profile.id, entry);
            while (entries.size > limit) entries.delete(entries.keys().next().value);
            return entry;
        }
        function resolve(info) {
            if (!info) return null;
            if (info.type === 'uuid') return get(info.value);
            for (var entry of entries.values()) {
                var value = entry.profile[info.type];
                if (value && String(value).toLowerCase() === String(info.value).toLowerCase()) return get(entry.profile.id);
            }
            return null;
        }
        function request(key, loader) {
            if (pending.has(key)) return pending.get(key);
            var version = generation;
            var promise = Promise.resolve().then(loader).then(function(value) {
                return version === generation ? value : null;
            }).finally(function() { if (pending.get(key) === promise) pending.delete(key); });
            pending.set(key, promise);
            return promise;
        }
        return { scope: scope, get: get, put: put, resolve: resolve, request: request,
            fresh: function(entry) { return !!entry && Date.now() - entry.loadedAt < ttl; },
            clear: function() { generation++; entries.clear(); pending.clear(); } };
    };
})(typeof window === 'undefined' ? globalThis : window);
