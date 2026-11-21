import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const map=JSON.parse(readFileSync('docs/chat-upgrades/migration-version-map.json','utf8'));
const history=JSON.parse(readFileSync('docs/chat-upgrades/production-postmigration-readonly.json','utf8')).verification.history;
test('chat migrations track the recorded production versions without duplicate runnable review drafts',()=>{
 assert.equal(map.project,'jmjtqidirpmnegzvmiaq');
 assert.deepEqual(map.migrations.map(x=>x.production_version),['20261120113353','20261120113401']);
 for(const item of map.migrations){
  assert.equal(readdirSync('supabase/migrations').filter(x=>x.endsWith('_'+item.name+'.sql')).length,1);
  assert(!existsSync('supabase/migrations/'+item.review_version+'_'+item.name+'.sql'));
  assert.equal(item.file,item.production_version+'_'+item.name+'.sql');
 }
});
test('reconciled SQL is byte-identical to the applied production statements',()=>{
 for(const item of map.migrations){
  const file=readFileSync('supabase/migrations/'+item.file);
  const entry=history.find(x=>x.version===item.production_version);
  assert(entry);assert.equal(entry.statements.length,1);assert.equal(entry.name,item.name);
  assert.equal(createHash('sha256').update(file).digest('hex'),item.sha256);
  assert.deepEqual(file,Buffer.from(entry.statements[0]));
 }
});
