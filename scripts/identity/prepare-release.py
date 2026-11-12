#!/usr/bin/env python3
"""Prepare only; never connects to a database. Requires captured production history."""
import argparse,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
history=json.load(open(a.baseline))['migrations'];version='20261109051236';name='default_profile_identity'
assert version not in {m['version'] for m in history},'Already applied'
migration=(root/'supabase/migrations'/f'{version}_{name}.sql').read_text();digest=hashlib.sha256(migration.encode()).hexdigest()
assert '\nBEGIN;\n' in migration and migration.rstrip().endswith('COMMIT;')
body=migration.replace('\nBEGIN;\n','\n',1).rstrip()[:-len('COMMIT;')].rstrip()
assert '$identity_migration$' not in body
versions=','.join(sorted(m['version'] for m in history));history_hash=hashlib.md5(versions.encode()).hexdigest()
script=f'''-- PREPARED ONLY. Production execution requires separate explicit approval.
-- Source migration SHA256: {digest}
-- This transaction does not update or delete any existing profile rows.
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtext('freeupper-default-identity-release'));
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF current_database() NOT IN ('postgres','freeupper_gates','freeupper_release_gate') THEN
  RAISE EXCEPTION 'Unexpected target database';
 END IF;
 IF (SELECT md5(string_agg(version,',' ORDER BY version)) FROM supabase_migrations.schema_migrations)
    IS DISTINCT FROM '{history_hash}' THEN
  RAISE EXCEPTION 'Migration history changed; regenerate and review release artifact';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='identity_private') THEN
  RAISE EXCEPTION 'Identity schema already exists; review before applying';
 END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE freeupper_id IS NULL OR freeupper_id !~ '^FU[0-9A-F]{{12}}$') THEN
  RAISE EXCEPTION 'Invalid existing FreeUpper IDs';
 END IF;
 IF EXISTS (SELECT 1 FROM public.profiles p JOIN public.profiles q
   ON lower(q.username)=lower(p.freeupper_id) AND q.id<>p.id) THEN
  RAISE EXCEPTION 'Default username conflict requires review';
 END IF;
END $guard$;
{body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('{version}','{name}',ARRAY[$identity_migration${body}$identity_migration$]);
COMMIT;
'''
pathlib.Path(a.output).write_text(script)
print(json.dumps({'source_sha256':digest,'production_history_versions':len(history),'history_md5':history_hash,'new_version':version,'output':a.output,'executed':False}))
