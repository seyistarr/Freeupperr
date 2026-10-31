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
            var known=entry.profile;
            entry.profile = complete ? Object.assign({}, profile) : Object.assign({}, profile, known);
            if(complete)['username','display_username','display_name','avatar_url','verified','verified_status','bio','cover_url'].forEach(function(key){
                if(entry.profile[key]===undefined && known[key]!==undefined)entry.profile[key]=known[key];
            });
            if (complete) entry.loadedAt = Date.now();
            entries.set(profile.id, entry);
            while(entries.size>limit){
                var disposable=Array.from(entries).find(function(pair){return pair[0]!==profile.id && !pair[1].view && !pair[1].modalViews && !pair[1].mutation && !pair[1].active;});
                if(!disposable)disposable=Array.from(entries).find(function(pair){return pair[0]!==profile.id && !pair[1].active;});
                entries.delete(disposable?disposable[0]:entries.keys().next().value);
            }
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
        function resource(id, key) { return get(id)?.resources?.[key]; }
        function setResource(id, key, value, loadedAt) {
            var entry=put({id:id},false);
            entry.resources=entry.resources || {};
            entry.revisions=entry.revisions || {};
            entry.revisions[key]=(entry.revisions[key] || 0)+1;
            entry.resources[key]={value:value,loadedAt:loadedAt ?? Date.now()};
            return value;
        }
        function invalidate(id, key, keepKnown) {
            var entry=get(id);if(!entry)return;
            entry.revisions=entry.revisions || {};
            entry.revisions[key]=(entry.revisions[key] || 0)+1;
            if(entry.resources?.[key]){
                if(keepKnown)entry.resources[key].loadedAt=0;else delete entry.resources[key];
            }
        }
        function loadResource(id, key, loader, force) {
            var entry=put({id:id},false), cached=resource(id,key);
            if(!force && cached && Date.now()-cached.loadedAt<ttl)return Promise.resolve(cached.value);
            var revision=entry.revisions?.[key] || 0;
            return request(id+':'+key+':'+revision,loader).then(function(value){
                if(value==null || get(id)!==entry || (entry.revisions?.[key] || 0)!==revision)return null;
                entry.resources=entry.resources || {};
                // An authorization read may return server truth while a mutation
                // is pending, but must not replace its optimistic button state.
                if(!entry.resources[key]?.value?.mutating)entry.resources[key]={value:value,loadedAt:Date.now()};
                return value;
            });
        }
        return { scope: scope, get: get, put: put, resolve: resolve, request: request,
            resource:resource,setResource:setResource,loadResource:loadResource,invalidate:invalidate,
            fresh: function(entry) { return !!entry && Date.now() - entry.loadedAt < ttl; },
            clear: function() { generation++; entries.clear(); pending.clear(); } };
    };
})(typeof window === 'undefined' ? globalThis : window);
