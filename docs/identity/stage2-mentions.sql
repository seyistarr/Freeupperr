-- These helpers exist only in this database session, not the exposed API schemas.
CREATE FUNCTION pg_temp.identity_utf16_length(v text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer FROM regexp_split_to_table(coalesce(v,''),'') c WHERE c<>''
$$;
CREATE FUNCTION pg_temp.identity_char_offset(v text,units integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i integer;used integer:=0;
BEGIN
 IF units<0 THEN RAISE EXCEPTION 'Invalid mention offset'; END IF;
 FOR i IN 0..length(v) LOOP
  IF used=units THEN RETURN i; END IF;
  IF i<length(v) THEN used:=used+CASE WHEN ascii(substr(v,i+1,1))>65535 THEN 2 ELSE 1 END; END IF;
 END LOOP;
 RAISE EXCEPTION 'Mention offset is not a valid UTF-16 boundary';
END $$;
CREATE FUNCTION pg_temp.identity_rewrite_text(v text,changes jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;a integer;b integer;
BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(changes) ORDER BY (value->>'start')::integer DESC LOOP
  IF position(r->>'old' IN v)>0 THEN
   a:=pg_temp.identity_char_offset(v,(r->>'start')::integer);
   b:=pg_temp.identity_char_offset(v,(r->>'end')::integer);
   IF substr(v,a+1,b-a) IS DISTINCT FROM r->>'old' THEN RAISE EXCEPTION 'Unverified mention text span'; END IF;
   v:=overlay(v PLACING r->>'new' FROM a+1 FOR b-a);
  END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(changes) LOOP
  IF position(substr(r->>'old',2) IN v)>0 THEN RAISE EXCEPTION 'Unreviewed email occurrence outside tagged span'; END IF;
 END LOOP;
 RETURN v;
END $$;
LOCK TABLE public.posts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.comments IN SHARE MODE;
DO $$
DECLARE post record;ref record;el jsonb;newel jsonb;changes jsonb;newmentions jsonb;hits integer;
 uname text;dname text;st integer;en integer;delta integer;shift_start integer;shift_end integer;
BEGIN
 -- New reference exposure since preview must not be silently omitted.
 IF EXISTS(SELECT 1 FROM public.posts p CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(p.mentions)='array' THEN p.mentions ELSE '[]'::jsonb END) probe
 JOIN auth.users u ON coalesce(probe->>'userId',probe->>'id')=u.id::text
 WHERE u.email_confirmed_at IS NOT NULL AND (probe->>'username'=u.email OR probe->>'displayName'=u.email)
 AND NOT EXISTS(SELECT 1 FROM approved_mention_posts a WHERE a.post_id=p.id)) THEN
 RAISE EXCEPTION 'Post mention exposure set changed; regenerate preview'; END IF;
 IF EXISTS(SELECT 1 FROM public.comments c CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(c.mentions)='array' THEN c.mentions ELSE '[]'::jsonb END) probe
 JOIN auth.users u ON coalesce(probe->>'userId',probe->>'id')=u.id::text
 WHERE u.email_confirmed_at IS NOT NULL AND (probe->>'username'=u.email OR probe->>'displayName'=u.email)) THEN
 RAISE EXCEPTION 'Comment mention correction requires separate reviewed manifest'; END IF;
 IF EXISTS(SELECT 1 FROM public.posts p
 CROSS JOIN LATERAL(VALUES(p.publish_payload),(p.media_plan)) docs(doc)
 CROSS JOIN LATERAL(
 SELECT v FROM jsonb_path_query(coalesce(docs.doc,'{}'::jsonb),'strict $.**.username','{}'::jsonb,true) v
 UNION ALL SELECT v FROM jsonb_path_query(coalesce(docs.doc,'{}'::jsonb),'strict $.**.displayName','{}'::jsonb,true) v
 ) snapshots
 JOIN auth.users u ON snapshots.v #>> '{}' = u.email
 WHERE u.email_confirmed_at IS NOT NULL) THEN
 RAISE EXCEPTION 'Nested identity snapshot requires a separately reviewed reference plan'; END IF;
 FOR post IN SELECT p.*,a.guard_token,a.expected_references FROM public.posts p JOIN approved_mention_posts a ON a.post_id=p.id LOOP
  IF post.guard_token IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_array(post.id,post.title,post.description,post.content,post.mentions)::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'Post reference or text changed; regenerate preview'; END IF;
  changes:='[]';newmentions:='[]';hits:=0;
  FOR el IN SELECT value FROM jsonb_array_elements(post.mentions) LOOP
   newel:=el;
   FOR ref IN SELECT u.email,p.username,p.display_name,b.new_username,b.new_display_name
    FROM auth.users u JOIN public.profiles p ON p.id=u.id
    LEFT JOIN identity_private.stage2_profile_backup b ON b.profile_id=p.id
    WHERE u.email_confirmed_at IS NOT NULL AND coalesce(el->>'userId',el->>'id')=u.id::text LOOP
    IF el->>'username'=ref.email OR el->>'displayName'=ref.email THEN hits:=hits+1; END IF;
    IF el->>'username'=ref.email THEN
     uname:=coalesce(ref.new_username,ref.username);
     IF uname IS NULL OR uname !~ '^[A-Za-z0-9_.]{1,30}$' THEN RAISE EXCEPTION 'Referenced canonical handle is not privacy-safe'; END IF;
     -- Stale mention metadata may no longer have a text span. Never rewrite
     -- unrelated post content; change only metadata if the old email is absent.
     IF position(ref.email IN coalesce(post.title,''))>0 OR position(ref.email IN coalesce(post.description,''))>0 OR position(ref.email IN coalesce(post.content,''))>0 THEN
      IF coalesce(el->>'start','') !~ '^[0-9]+$' OR coalesce(el->>'end','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Missing trusted mention offsets'; END IF;
      st:=(el->>'start')::integer;en:=(el->>'end')::integer;
      IF en-st<>pg_temp.identity_utf16_length('@'||ref.email) THEN RAISE EXCEPTION 'Invalid mention span length'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(changes) c WHERE st<(c->>'end')::integer AND en>(c->>'start')::integer) THEN RAISE EXCEPTION 'Overlapping mention spans'; END IF;
      changes:=changes||jsonb_build_array(jsonb_build_object('start',st,'end',en,'old','@'||ref.email,'new','@'||uname,'delta',pg_temp.identity_utf16_length('@'||uname)-(en-st)));
     END IF;
     newel:=jsonb_set(newel,'{username}',to_jsonb(uname));
    END IF;
    IF el->>'displayName'=ref.email THEN
     dname:=coalesce(ref.new_display_name,ref.display_name);
     IF dname IS NULL OR position(ref.email IN dname)>0 THEN RAISE EXCEPTION 'Referenced display name remains exposed'; END IF;
     newel:=jsonb_set(newel,'{displayName}',to_jsonb(dname));
    END IF;
   END LOOP;
   newmentions:=newmentions||jsonb_build_array(newel);
  END LOOP;
  IF hits<>post.expected_references THEN RAISE EXCEPTION 'Reference evidence changed'; END IF;
  -- Adjust all mention offsets, including unaffected mentions after the replacement.
  post.mentions:=newmentions;newmentions:='[]';
  FOR el IN SELECT value FROM jsonb_array_elements(post.mentions) LOOP
   newel:=el;
   IF jsonb_array_length(changes)>0 THEN
    IF coalesce(el->>'start','') !~ '^[0-9]+$' OR coalesce(el->>'end','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Unadjustable mention offsets'; END IF;
    st:=(el->>'start')::integer;en:=(el->>'end')::integer;
    SELECT coalesce(sum((c->>'delta')::integer) FILTER(WHERE (c->>'start')::integer<st),0),coalesce(sum((c->>'delta')::integer) FILTER(WHERE (c->>'start')::integer<en),0)
    INTO shift_start,shift_end FROM jsonb_array_elements(changes) c;
    newel:=jsonb_set(jsonb_set(newel,'{start}',to_jsonb(st+shift_start)),'{end}',to_jsonb(en+shift_end));
   END IF;
   newmentions:=newmentions||jsonb_build_array(newel);
  END LOOP;
  INSERT INTO identity_private.stage2_post_backup
  SELECT p.id,p.title,p.description,p.content,p.mentions,
   pg_temp.identity_rewrite_text(p.title,changes),pg_temp.identity_rewrite_text(p.description,changes),pg_temp.identity_rewrite_text(p.content,changes),newmentions
  FROM public.posts p WHERE p.id=post.id;
 END LOOP;
 IF (SELECT count(*) FROM identity_private.stage2_post_backup)<>(SELECT count(*) FROM approved_mention_posts) THEN RAISE EXCEPTION 'Missing approved post'; END IF;
END $$;
UPDATE public.posts p SET mentions=b.new_mentions
FROM identity_private.stage2_post_backup b WHERE p.id=b.post_id
 AND p.title IS NOT DISTINCT FROM b.new_title AND p.description IS NOT DISTINCT FROM b.new_description AND p.content IS NOT DISTINCT FROM b.new_content;
UPDATE public.posts p SET title=b.new_title,description=b.new_description,content=b.new_content,mentions=b.new_mentions
FROM identity_private.stage2_post_backup b WHERE p.id=b.post_id
 AND (p.title IS DISTINCT FROM b.new_title OR p.description IS DISTINCT FROM b.new_description OR p.content IS DISTINCT FROM b.new_content);
