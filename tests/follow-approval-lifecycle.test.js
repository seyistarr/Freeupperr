import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile('supabase/migrations/20261027121316_sync_public_follow_approvals.sql', 'utf8');
const pub = '00000000-0000-4000-8000-000000000001';
const priv = '00000000-0000-4000-8000-000000000002';
const viewer = '00000000-0000-4000-8000-000000000003';
const suspended = '00000000-0000-4000-8000-000000000004';
const historic = '00000000-0000-4000-8000-000000000005';
test('public follow approvals track active relationships without approving private accounts or historical rows', async t => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA privacy_v2_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE public.profiles(id uuid primary key,is_private boolean,suspended boolean);
      CREATE TABLE public.follows(follower_id uuid,following_id uuid,status text default 'active',primary key(follower_id,following_id));
      CREATE TABLE privacy_v2_private.follow_approvals(follower_id uuid,following_id uuid,
        approval_kind text check(approval_kind in ('public_auto','owner')),approved_by uuid,approved_at timestamptz default now(),
        primary key(follower_id,following_id),check((approval_kind='public_auto' and approved_by is null) or (approval_kind='owner' and approved_by=following_id)));
      ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_follows ON public.follows TO authenticated USING(follower_id=auth.uid()) WITH CHECK(follower_id=auth.uid());
      GRANT SELECT,INSERT,UPDATE,DELETE ON public.follows TO authenticated;
      GRANT SELECT ON public.profiles TO authenticated;
      INSERT INTO public.profiles VALUES('${pub}',false,false),('${priv}',true,false),('${viewer}',false,false),('${suspended}',false,true),('${historic}',false,false);
      INSERT INTO public.follows VALUES('${historic}','${pub}','active');`);
    await db.exec(migration);
    async function client(sql, params = []) {
      await db.exec('SET ROLE authenticated');
      try { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [viewer]); return await db.query(sql, params); }
      finally { await db.exec('RESET ROLE'); }
    }
    const approval = async target => (await db.query('SELECT approval_kind,approved_by FROM privacy_v2_private.follow_approvals WHERE follower_id=$1 AND following_id=$2',[viewer,target])).rows;
    await t.test('existing active follows are not backfilled', async () => {
      assert.equal((await db.query('SELECT count(*)::int n FROM privacy_v2_private.follow_approvals')).rows[0].n, 0);
    });
    await t.test('a new public follow is approved by the database trigger', async () => {
      await client('INSERT INTO public.follows VALUES($1,$2,\'active\')',[viewer,pub]);
      assert.deepEqual(await approval(pub), [{approval_kind:'public_auto',approved_by:null}]);
    });
    await t.test('private and suspended accounts are never automatically approved', async () => {
      for (const target of [priv,suspended]) await client('INSERT INTO public.follows VALUES($1,$2,\'active\')',[viewer,target]);
      assert.deepEqual(await approval(priv),[]); assert.deepEqual(await approval(suspended),[]);
    });
    await t.test('unfollow removes owner approval; re-following a private account requires approval again', async () => {
      await db.query("INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind,approved_by) VALUES($1,$2,'owner',$2)",[viewer,priv]);
      await client('DELETE FROM public.follows WHERE following_id=$1',[priv]);
      assert.deepEqual(await approval(priv),[]);
      await client('INSERT INTO public.follows VALUES($1,$2,\'active\')',[viewer,priv]);
      assert.deepEqual(await approval(priv),[]);
    });
    await t.test('deactivation clears approval and public reactivation establishes a new approval', async () => {
      await client("UPDATE public.follows SET status='pending' WHERE following_id=$1",[pub]);
      assert.deepEqual(await approval(pub),[]);
      await client("UPDATE public.follows SET status='active' WHERE following_id=$1",[pub]);
      assert.equal((await approval(pub))[0].approval_kind,'public_auto');
    });
    await t.test('changing a follow target cannot transfer its prior approval', async () => {
      await client('DELETE FROM public.follows WHERE following_id=$1',[priv]);
      await client('UPDATE public.follows SET following_id=$1 WHERE following_id=$2',[priv,pub]);
      assert.deepEqual(await approval(pub),[]); assert.deepEqual(await approval(priv),[]);
    });
    await t.test('clients cannot write owner approvals or execute the private trigger directly', async () => {
      await assert.rejects(client("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'owner',$2,now())",[viewer,priv]), /permission denied/);
      assert.equal((await db.query("SELECT has_function_privilege('authenticated','privacy_v2_private.sync_follow_approval()','execute') allowed")).rows[0].allowed,false);
    });
  } finally { await db.close(); }
});
