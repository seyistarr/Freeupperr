import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../chat.js', import.meta.url), 'utf8');

test('composer references are rebound after restoring replaced composer markup', () => {
  assert.match(source, /function refreshComposerElements\(\)/);
  assert.match(source, /const composer = refreshComposerElements\(\);[\s\S]*?composer\.input\.disabled = true/);
  assert.match(source, /messageInputArea\.classList\.remove\('blocked-input'\);[\s\S]*?refreshComposerElements\(\);[\s\S]*?canSendInConversation/);
});

test('unread badge uses the authenticated-user RPC wrapper, not a caller-selected UUID', () => {
  assert.match(source, /sb\.rpc\('get_my_unread_message_count'\)/);
  assert.doesNotMatch(source, /sb\.rpc\('get_unread_message_count',\s*\{\s*p_user_id:/);
});

test('read acknowledgement drains messages that arrive during an in-flight upsert', () => {
  assert.match(source, /while \(session === activitySession && convId === selectedConversationId/);
  assert.match(source, /const unread = messages\.filter\(m => m\.conversation_id === convId/);
  assert.match(source, /onConflict: 'message_id,user_id'/);
  assert.match(source, /await loadConversations\(\)/);
});

test('read worker schedules another pass if unread messages remain after releasing lock', () => {
  assert.match(source, /if \(markReadInFlight\.get\(convId\) === task\)[\s\S]*?markReadInFlight\.delete\(convId\)[\s\S]*?const hasUnread = stillSelected && messages\.some/);
  assert.match(source, /if \(hasUnread\)[\s\S]*?markVisibleMessagesRead\(convId\)/);
});
