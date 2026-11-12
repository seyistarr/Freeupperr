-- READ ONLY. Never returns mention strings or post text.
WITH refs AS (
 SELECT p.id post_id,p.title,p.description,p.content,p.mentions,el,u.email,u.email_confirmed_at
 FROM public.posts p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.mentions)='array' THEN p.mentions ELSE '[]'::jsonb END) el
 JOIN auth.users u ON coalesce(el->>'userId',el->>'id')=u.id::text
 WHERE u.email_confirmed_at IS NOT NULL AND (el->>'username'=u.email OR el->>'displayName'=u.email)
)
SELECT post_id,count(*)::integer expected_references,
 encode(sha256(convert_to(jsonb_build_array(post_id,title,description,content,mentions)::text,'UTF8')),'hex') guard_token,
 count(*) FILTER(WHERE el->>'username'=email) username_references,
 count(*) FILTER(WHERE el->>'displayName'=email) display_name_references
FROM refs GROUP BY post_id,title,description,content,mentions ORDER BY post_id;
