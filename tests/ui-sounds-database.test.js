import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('existing settings RPC atomically patches sound, preserves JSON/defaults/ACLs, and isolates users', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.user_settings (
        user_id uuid primary key,
        theme text default 'dark', language text default 'en', autoplay boolean default true,
        private_account boolean default false, comment_permission text default 'everyone', download_quality text default 'auto',
        notification_settings jsonb default '{"likes":true,"follows":true,"replies":true,"comments":true,"mentions":true}'
      );
      alter table public.user_settings enable row level security;
      create policy own_settings on public.user_settings for all using (user_id=auth.uid());
      create function public.update_user_setting(p_key text,p_value text) returns boolean language sql security definer as $$select true$$;
      revoke all on function public.update_user_setting(text,text) from public;
      grant execute on function public.update_user_setting(text,text) to authenticated;
    `);
    const acl = (await db.query("select proacl::text from pg_proc where proname='update_user_setting'")).rows[0].proacl;
    await db.exec(await readFile('supabase/migrations/20261028153536_notification_sound_preference.sql', 'utf8'));
    assert.equal((await db.query("select proacl::text from pg_proc where proname='update_user_setting'")).rows[0].proacl, acl);
    const alice = '00000000-0000-0000-0000-000000000001', bob = '00000000-0000-0000-0000-000000000002';
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [alice]);
    await db.exec("set role authenticated; select public.update_user_setting('notification_sound','false'); reset role;");
    let row = (await db.query('select * from user_settings where user_id=$1', [alice])).rows[0];
    assert.deepEqual(row.notification_settings, { likes: true, follows: true, replies: true, comments: true, mentions: true, sound: false });
    await db.query('update user_settings set notification_settings=$1 where user_id=$2', [{ ...row.notification_settings, likes: false, custom: { value: 12 } }, alice]);
    await db.exec("set role authenticated; select public.update_user_setting('notification_sound','true'); select public.update_user_setting('theme','light'); reset role;");
    row = (await db.query('select * from user_settings where user_id=$1', [alice])).rows[0];
    assert.equal(row.theme, 'light'); assert.equal(row.notification_settings.sound, true);
    assert.equal(row.notification_settings.likes, false); assert.deepEqual(row.notification_settings.custom, { value: 12 });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
    await db.exec("set role authenticated; select public.update_user_setting('notification_sound','false'); reset role;");
    assert.equal((await db.query('select notification_settings from user_settings where user_id=$1', [alice])).rows[0].notification_settings.sound, true);
    await db.query('update user_settings set notification_settings=null where user_id=$1', [bob]);
    await db.exec("set role authenticated; select public.update_user_setting('notification_sound','true'); reset role;");
    assert.deepEqual((await db.query('select notification_settings from user_settings where user_id=$1', [bob])).rows[0].notification_settings, { sound: true });
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from user_settings'), /permission denied/);
    await assert.rejects(db.query("select update_user_setting('notification_sound','maybe')"), /Invalid sound/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query("select update_user_setting('notification_sound','true')"), /permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select update_user_setting('notification_sound','true')"), /Authentication required/);
  } finally { await db.close(); }
});
