import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { schemaSQL, validateProject } from '../scripts/prepare-staging-db.mjs';
import { fixtureSQL } from '../scripts/prepare-staging-fixtures.mjs';
const metadata=JSON.parse(await fs.readFile(new URL('../supabase/staging/schema-metadata.json',import.meta.url),'utf8'));
const sql=schemaSQL(metadata,'abcdefghijklmnopqrst');
test('schema package contains catalog metadata only and no production identifiers/secrets/sequence values',()=>{
    assert.equal(metadata.tables.length,57);assert.equal(metadata.functions.length,94);
    assert.doesNotMatch(JSON.stringify(metadata),/last_value|jmjtqidirpmnegzvmiaq|-----BEGIN .*PRIVATE KEY|sb_secret_|eyJ[A-Za-z0-9_-]{20,}\./);
    assert.doesNotMatch(sql,/jmjtqidirpmnegzvmiaq|freeupper-notifications|www\.freeupper\.com/);
    assert.equal((sql.match(/CREATE TABLE public\./g)||[]).length,57);
    assert.match(sql,/Refusing to install over an existing FreeUpper database/);
    assert.ok(metadata.tables.every(t=>t.rls));
});
test('production target and invalid project references cannot render a staging package',()=>{
    for(const value of ['jmjtqidirpmnegzvmiaq',undefined,'','bad','../../prod'])assert.throws(()=>validateProject(value));
});
test('outbound staging webhook triggers stay disabled and use staging URLs plus Vault secret reference',()=>{
    assert.match(sql,/https:\/\/abcdefghijklmnopqrst.functions.supabase.co\/send-push-notification/);
    assert.match(sql,/ALTER TABLE "public"\."messages" DISABLE TRIGGER "trg_notify_new_message"/);
    assert.match(sql,/ALTER TABLE "public"\."notifications" DISABLE TRIGGER "trg_notify_social_notification"/);
    assert.doesNotMatch(sql,/ENABLE TRIGGER.*trg_notify/);
    assert.equal((sql.match(/x-freeupper-staging-secret/g)||[]).length,2);
    assert.match(sql,/vault.decrypted_secrets WHERE name = 'freeupper_staging_webhook_secret'/);
});
test('signup trigger, JSONB defaults, owner token policies and chat mute schema are retained',()=>{
    assert.match(sql,/on_auth_user_created/);assert.match(sql,/handle_new_user/);
    const settings=metadata.tables.find(t=>t.name==='user_settings').columns.find(c=>c.name==='notification_settings');
    assert.equal(settings.type,'jsonb');assert.match(settings.default,/likes/);
    assert.equal(metadata.policies.filter(p=>p.tablename==='push_tokens').length,4);
    assert.ok(metadata.policies.filter(p=>p.tablename==='push_tokens').every(p=>(p.qual||p.with_check).includes('user_id')));
    assert.ok(metadata.tables.find(t=>t.name==='conversations').columns.some(c=>c.name==='muted_by'&&c.type==='uuid[]'));
});
test('verified function, constraint, policy, sequence and realtime inventories are retained',()=>{
    assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\./g)||[]).length,94);
    assert.equal((sql.match(/ ADD CONSTRAINT /g)||[]).length,205);
    assert.equal((sql.match(/CREATE POLICY /g)||[]).length,197);
    assert.equal((sql.match(/CREATE SEQUENCE public\./g)||[]).length+(sql.match(/AS IDENTITY \(SEQUENCE NAME/g)||[]).length,12);
    assert.match(sql,/MAXVALUE 9223372036854775807/);
    assert.equal((sql.match(/ALTER PUBLICATION supabase_realtime ADD TABLE /g)||[]).length,metadata.realtime.length);
    for(const name of ['get_unread_message_count','get_profile_by_freeupper_id'])assert.ok(metadata.functions.some(f=>f.name===name),name);
});
test('fixture preparation requires staging users and cannot create Auth users or send push',()=>{
    assert.throws(()=>fixtureSQL('jmjtqidirpmnegzvmiaq','a','b'));
    assert.throws(()=>fixtureSQL('abcdefghijklmnopqrst','a','b'));
    const fixture=fixtureSQL('abcdefghijklmnopqrst','00000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-00000000000b');
    assert.doesNotMatch(fixture,/INSERT INTO auth\.|push_tokens|password|https:\/\//);
    assert.match(fixture,/stage_test_a/);assert.match(fixture,/stage_test_b/);
    assert.match(fixture,/Outbound webhook triggers must remain disabled/);
});
