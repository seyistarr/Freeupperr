import {expect} from '@playwright/test';

// waitForFunction polls synchronous truthiness in our pinned Playwright. An
// async predicate returns a truthy Promise even when it resolves to false.
export async function waitForWaitingWorker(page) {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return registration?.waiting?.state;
  }), {timeout:30000, message:'candidate must finish installation and wait'}).toBe('installed');
}

// Start this on the captured candidate before closing the final old client.
// No new controlled page may be created until this activation barrier resolves.
export async function waitForCandidateActivation(candidate, oldCache) {
  return candidate.evaluate(async oldCache => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const keys = await caches.keys();
      if (!self.registration.waiting && self.registration.active?.state === 'activated' && !keys.includes(oldCache)) {
        return {active:'activated', oldCacheRemoved:true};
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('candidate did not activate after old clients closed');
  }, oldCache);
}
