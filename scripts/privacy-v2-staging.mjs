// Run only against this repository's isolated feature-branch preview alias.
const origin = 'https://freeupper-git-feature-post-privacy-v-3ab7d2-seyistarrs-projects.vercel.app';
const action = process.argv[2] || 'readiness';
if (!['readiness', 'cleanup'].includes(action)) throw new Error('Use readiness or cleanup');
const options = { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000) };
let path = '/api/privacy-v2-publish?readiness=1';
if (action === 'cleanup') {
  const token = process.env.FREEUPPER_CLEANUP_TOKEN;
  if (!token || token.length < 32) throw new Error('Configure the staging-only FREEUPPER_CLEANUP_TOKEN in the job environment');
  path = '/api/privacy-v2-publish?worker=cleanup';
  options.method = 'POST'; options.headers = { Authorization: 'Bearer ' + token };
}
try {
  const response = await fetch(origin + path, options);
  const data = await response.json();
  // Print only the public readiness booleans or aggregate cleanup counts.
  console.log(action === 'readiness' ? {
    status: response.status, ready: data.ready === true, database: data.database === true,
    cloud: data.cloud === true, configuration: data.configuration === true
  } : { status: response.status, processed: data.processed ?? 0, pending: data.pending ?? 0 });
  if (!response.ok) process.exitCode = 1;
} catch (_) { console.error('Staging request unavailable. No credentials were logged.'); process.exitCode = 1; }
