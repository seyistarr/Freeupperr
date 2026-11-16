-- REVIEW ONLY. Run as an approved maintenance role, never from a browser.
-- Schedule bounded batches periodically after approval; expired state is already hidden by RLS.
-- DEFAULT replica identity means DELETE change records carry only the opaque primary key.
WITH expired AS (
 SELECT id FROM public.chat_activity WHERE expires_at < clock_timestamp() - interval '1 minute'
 ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.chat_activity a USING expired e WHERE a.id=e.id;
