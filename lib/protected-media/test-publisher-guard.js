// A production test publisher must be explicitly approved in the database.
// Staging is unaffected. Do not grant public/anon EXECUTE on the approval RPC.
export async function requireTestPublisher(db, runtime, userId) {
  if (runtime?.mode !== 'production') return true;
  if (typeof userId !== 'string') return false;
  try {
    const { data, error } = await db.rpc('privacy_v2_test_publisher_allowed', { p_user: userId });
    return !error && data === true;
  } catch (_) {
    return false;
  }
}
