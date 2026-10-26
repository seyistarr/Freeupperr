import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '00000000-0000-4000-8000-000000000001';
const follower = '00000000-0000-4000-8000-000000000002';
const mutual = '00000000-0000-4000-8000-000000000003';
const stranger = '00000000-0000-4000-8000-000000000005';
const fix = await readFile(new URL('../docs/cloudflare/anonymous-post-read-fix.REVIEW.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../docs/cloudflare/anonymous-post-read-rollback.REVIEW.sql', import.meta.url), 'utf8');

test('reviewed role-scoped SQL restores public reads without helper grants', async t => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/anonymous-post-read-schema.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO profiles VALUES
      ('${owner}',false,false),
      ('00000000-0000-4000-8000-000000000004',true,false),
      ('00000000-0000-4000-8000-000000000006',false,true);
      INSERT INTO privacy_v2_private.approved_follows VALUES
      ('${follower}','${owner}'),('${mutual}','${owner}'),('${owner}','${mutual}');`);
    const fixtures = [
      ['public', owner, 'public', 'published', false, false],
      ['followers', owner, 'followers', 'published', false, false],
      ['friends', owner, 'friends', 'published', false, false],
      ['only_me', owner, 'only_me', 'published', false, false],
      ['draft', owner, 'public', 'draft', false, false],
      ['deleted', owner, 'public', 'published', true, false],
      ['hidden', owner, 'public', 'published', false, true],
      ['null_visibility', owner, null, 'published', false, false],
      ['null_state', owner, 'public', null, false, false],
      ['null_hidden', owner, 'public', 'published', false, null],
      ['private_author', '00000000-0000-4000-8000-000000000004', 'public', 'published', false, false],
      ['suspended_author', '00000000-0000-4000-8000-000000000006', 'public', 'published', false, false]
    ];
    for (const row of fixtures) await db.query('INSERT INTO posts VALUES ($1,$2,$3,$4,$5,$6)', row);
    async function asRole(role, user, sql = 'SELECT id FROM posts ORDER BY id') {
      await db.exec(`SET ROLE ${role}`);
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user || '']);
        return await db.query(sql);
      } finally { await db.exec('RESET ROLE'); }
    }
    const before = new Map();
    for (const user of [owner, follower, mutual, stranger, null]) before.set(user, (await asRole('authenticated', user)).rows);
    await t.test('reproduces the production anonymous permission failure', async () => {
      await assert.rejects(asRole('anon', null), /permission denied for function privacy_v2_approved_edge/);
    });
    await db.exec(fix);
    await t.test('anonymous reads expose only eligible public posts', async () => {
      assert.deepEqual((await asRole('anon', null)).rows, [{ id: 'public' }]);
    });
    await t.test('authenticated owner, follower, mutual and stranger results are unchanged', async () => {
      for (const [user, rows] of before) assert.deepEqual((await asRole('authenticated', user)).rows, rows);
      const followerRows = before.get(follower).map(r => r.id);
      assert.ok(followerRows.includes('followers'));
      assert.ok(!followerRows.includes('friends'));
      assert.ok(before.get(mutual).some(r => r.id === 'friends'));
      assert.ok(!before.get(stranger).some(r => r.id === 'followers' || r.id === 'friends' || r.id === 'only_me'));
    });
    await t.test('the helper and private relationship schema remain inaccessible to anon', async () => {
      await assert.rejects(asRole('anon', null, `SELECT privacy_v2_approved_edge('${follower}','${owner}')`), /permission denied/);
      await assert.rejects(asRole('anon', null, 'SELECT * FROM privacy_v2_private.approved_follows'), /permission denied/);
      assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.posts'::regclass")).rows[0].relrowsecurity, true);
      assert.equal((await db.query("SELECT has_function_privilege('anon','public.privacy_v2_approved_edge(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed, false);
    });
    await t.test('rollback restores the prior policy and does not open reads', async () => {
      await db.exec(rollback);
      await assert.rejects(asRole('anon', null), /permission denied for function privacy_v2_approved_edge/);
      assert.deepEqual((await asRole('authenticated', mutual)).rows, before.get(mutual));
    });
    await t.test('unexpected policy drift aborts the patch', async () => {
      await db.exec('ALTER POLICY privacy_v2_restricted_post_read_boundary ON posts USING (false)');
      await assert.rejects(db.exec(fix), /Post read boundary changed/);
      await db.exec('ROLLBACK');
    });
  } finally { await db.close(); }
});
