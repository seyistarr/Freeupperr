-- READ ONLY. Field-level evidence, with no email values in the output.
WITH fields AS (
 SELECT p.id,p.freeupper_id,p.username,p.display_name,p.display_username,
 u.email,u.email_confirmed_at,f.field,f.value,
 CASE WHEN f.value=u.email AND u.email_confirmed_at IS NOT NULL
 THEN 'confirmed_exact_verified_email'
 WHEN f.value LIKE '%@%' THEN 'ambiguous_at_value' ELSE 'preserve' END decision
 FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id
 CROSS JOIN LATERAL (VALUES ('username',p.username),('display_name',p.display_name),('display_username',p.display_username)) f(field,value)
)
SELECT freeupper_id,field,decision,
 CASE WHEN decision='confirmed_exact_verified_email' THEN
  CASE WHEN field='display_name' THEN 'FreeUpper User'
       WHEN field='display_username' AND username IS DISTINCT FROM email THEN username
       ELSE lower(freeupper_id) END END proposed_value,
 CASE WHEN decision='confirmed_exact_verified_email' THEN
  encode(sha256(convert_to(jsonb_build_array(id,freeupper_id,field,username,display_name,display_username,email,
  to_char(email_confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'))::text,'UTF8')),'hex') END guard_token
FROM fields WHERE decision<>'preserve' ORDER BY freeupper_id,field;
