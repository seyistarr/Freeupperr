import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject } from './prepare-staging-db.mjs';
export function fixtureSQL(ref, userA, userB) {
    validateProject(ref);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(userA || '') || !uuid.test(userB || '') || userA === userB) throw new Error('Two distinct staging Auth user UUIDs are required');
    return `-- Synthetic fixtures for staging project ${ref}. Creates no Auth users or tokens.\nBEGIN;\nDO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='${userA}' AND username='stage_test_a')\n    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='${userB}' AND username='stage_test_b') THEN\n    RAISE EXCEPTION 'Create the two named staging accounts through staging Auth first';\n  END IF;\n  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_notify_new_message','trg_notify_social_notification') AND tgenabled <> 'D') THEN\n    RAISE EXCEPTION 'Outbound webhook triggers must remain disabled during fixture setup';\n  END IF;\nEND $$;\nINSERT INTO public.user_settings(user_id) VALUES ('${userA}'),('${userB}') ON CONFLICT(user_id) DO NOTHING;\nINSERT INTO public.conversations(id,user1_id,user2_id) VALUES ('00000000-0000-4000-8000-000000000001','${userA}','${userB}') ON CONFLICT(id) DO NOTHING;\nINSERT INTO public.messages(conversation_id,sender_id,text) VALUES ('00000000-0000-4000-8000-000000000001','${userA}','Synthetic staging message. No production data.');\nCOMMIT;\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const argument = name => process.argv[process.argv.indexOf(name)+1];
    try {
        for (const name of ['--project-ref','--user-a','--user-b','--output']) if (!process.argv.includes(name)) throw new Error('Required: '+name);
        const sql = fixtureSQL(argument('--project-ref'),argument('--user-a'),argument('--user-b'));
        await fs.writeFile(path.resolve(argument('--output')),sql);
        console.log('Synthetic fixtures prepared locally. No database connection occurred.');
    } catch (error) { console.error(error.message); process.exitCode=1; }
}
