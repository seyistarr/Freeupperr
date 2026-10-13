(() => {
    'use strict';
    const config = globalThis.FreeUpperConfig;
    if (!config || !config.allowedOrigins.includes(globalThis.location.origin)) {
        delete globalThis.FreeUpperConfig;
        throw new Error('FreeUpper configuration is unavailable for this origin.');
    }
    const freeze = object => { Object.values(object).forEach(value => {
        if (value && typeof value === 'object') freeze(value);
    }); return Object.freeze(object); };
    freeze(config);
    globalThis.FreeUpperNotificationUrl = value => {
        const url = new URL(value || '/index.html', config.environment === 'staging' ? config.appOrigin : globalThis.location.origin);
        // Keep legacy production navigation. Staging rejects cross-origin payload destinations.
        if (config.environment === 'staging' && url.origin !== config.appOrigin) return config.appOrigin + '/index.html';
        return url.href;
    };
    // The existing upload presets belong to production. Block staging writes even in old upload paths.
    if (config.environment === 'staging' && globalThis.fetch) {
        const originalFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = (input, init) => {
            const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
            const url = new URL(value, globalThis.location.origin);
            if (url.hostname === 'api.cloudinary.com') return Promise.reject(new Error('Media uploads are disabled in staging.'));
            return originalFetch(input, init);
        };
    }
})();
