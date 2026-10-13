import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function validateProject(ref) {
    if (!/^[a-z0-9]{20}$/.test(ref || '') || ref === 'jmjtqidirpmnegzvmiaq') throw new Error('A distinct staging project reference is required');
    return ref;
}
export function schemaSQL(metadata, ref) {
    validateProject(ref);
    const endpoint = 'https://' + ref + '.functions.supabase.co/send-push-notification';
    const sql = [
        '-- Schema only, captured from catalog metadata on 2026-10-13. No production rows or secrets.',
        '-- Intended target: ' + ref + '. Review target dashboard before running. Fresh Supabase project only.',
        '-- Outbound webhook triggers stay DISABLED. No seed data is included.',
        'BEGIN;',
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','messages','push_tokens')) THEN RAISE EXCEPTION 'Refusing to install over an existing FreeUpper database'; END IF; END $$;`,
        'SET LOCAL check_function_bodies = false;'
    ];
    for (const extension of metadata.extensions) {
        if (['uuid-ossp', 'pgcrypto', 'pg_trgm', 'vector', 'pg_net'].includes(extension.name))
            sql.push('CREATE EXTENSION IF NOT EXISTS ' + quote(extension.name) + ' WITH SCHEMA ' + quote(extension.schema) + ';');
    }
    for (const item of metadata.enums || []) sql.push('CREATE TYPE public.' + quote(item.name) + ' AS ENUM (' + item.labels.map(literal).join(', ') + ');');
    const identitySequences = new Set((metadata.identities || []).map(item => item.sequence.split('.').at(-1).replaceAll('"','')));
    for (const sequence of metadata.sequences || []) if (!identitySequences.has(sequence.sequencename)) sql.push('CREATE SEQUENCE public.' + quote(sequence.sequencename) +
        ' AS ' + sequence.data_type + ' INCREMENT BY ' + sequence.increment_by + ' MINVALUE ' + sequence.min_value +
        ' MAXVALUE ' + sequence.max_value + ' START WITH ' + sequence.start_value + ' CACHE ' + sequence.cache_size +
        (sequence.cycle ? ' CYCLE' : ' NO CYCLE') + ';');
    for (const table of metadata.tables) {
        const columns = table.columns.map(column => {
            let definition = quote(column.name) + ' ' + column.type;
            if (column.identity) {
                const identity = metadata.identities?.find(item => item.table === table.name && item.column === column.name);
                const sequence = metadata.sequences?.find(item => 'public.' + item.sequencename === identity?.sequence);
                if (!sequence) throw new Error('Missing identity sequence metadata: ' + table.name);
                definition += ' GENERATED ' + (column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT') + ' AS IDENTITY (SEQUENCE NAME public.' + quote(sequence.sequencename) +
                    ' START WITH ' + sequence.start_value + ' INCREMENT BY ' + sequence.increment_by + ' MINVALUE ' + sequence.min_value + ' MAXVALUE ' + sequence.max_value + ' CACHE ' + sequence.cache_size + (sequence.cycle ? ' CYCLE' : ' NO CYCLE') + ')';
            } else if (column.generated) definition += ' GENERATED ALWAYS AS (' + column.default + ') STORED';
            else if (column.default !== null) definition += ' DEFAULT ' + column.default;
            if (column.not_null) definition += ' NOT NULL';
            return definition;
        });
        sql.push('CREATE TABLE public.' + quote(table.name) + ' (\n  ' + columns.join(',\n  ') + '\n);');
        if (table.rls) sql.push('ALTER TABLE public.' + quote(table.name) + ' ENABLE ROW LEVEL SECURITY;');
        if (table.force_rls) sql.push('ALTER TABLE public.' + quote(table.name) + ' FORCE ROW LEVEL SECURITY;');
    }
    for (const fn of metadata.functions) {
        let definition = fn.definition.replaceAll('__STAGING_PUSH_ENDPOINT__', endpoint);
        if (['notify_new_message', 'notify_new_social_notification'].includes(fn.name)) {
            definition = definition.replace("jsonb_build_object('Content-Type', 'application/json')",
                "jsonb_build_object('Content-Type', 'application/json', 'x-freeupper-staging-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'freeupper_staging_webhook_secret'))");
        }
        sql.push(definition.trim() + ';');
    }
    for (const constraint of [...metadata.constraints].sort((a,b) => (a.type==='f')-(b.type==='f'))) {
        sql.push('ALTER TABLE public.' + quote(constraint.table) + ' ADD CONSTRAINT ' + quote(constraint.name) + ' ' + constraint.definition + ';');
    }
    const constraintIndexes = new Set(metadata.constraints.filter(c => ['p','u','x'].includes(c.type)).map(c => c.name));
    for (const index of metadata.indexes || []) if (!constraintIndexes.has(index.name)) sql.push(index.definition + ';');
    for (const view of metadata.views || []) {
        if (view.kind !== 'v') throw new Error('Materialized view requires separate review');
        sql.push('CREATE VIEW public.' + quote(view.name) + (view.options?.length ? ' WITH (' + view.options.join(', ') + ')' : '') + ' AS ' + view.definition.trim().replace(/;$/, '') + ';');
    }
    for (const policy of metadata.policies) sql.push('CREATE POLICY ' + quote(policy.policyname) + ' ON public.' + quote(policy.tablename) +
        ' AS ' + policy.permissive + ' FOR ' + policy.cmd + ' TO ' + policy.roles.map(role => role === 'public' ? 'PUBLIC' : quote(role)).join(', ') +
        (policy.qual ? ' USING (' + policy.qual + ')' : '') + (policy.with_check ? ' WITH CHECK (' + policy.with_check + ')' : '') + ';');
    for (const trigger of metadata.triggers) {
        sql.push(trigger.definition + ';');
        const disabled = /trg_notify_new_message|trg_notify_social_notification/.test(trigger.name) || trigger.enabled === 'D';
        if (disabled) sql.push('ALTER TABLE ' + quote(trigger.schema) + '.' + quote(trigger.table) + ' DISABLE TRIGGER ' + quote(trigger.name) + ';');
    }
    // Do not inherit newly created project defaults that could broaden the captured grants.
    sql.push('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;');
    for (const grant of metadata.grants || []) sql.push('GRANT ' + grant.privilege_type + ' ON TABLE public.' + quote(grant.table_name) + ' TO ' + quote(grant.grantee) + (grant.is_grantable==='YES' ? ' WITH GRANT OPTION' : '') + ';');
    for (const grant of metadata.columnGrants || []) if (['PUBLIC','anon','authenticated','service_role','postgres'].includes(grant.grantee)) sql.push('GRANT ' + grant.privilege + ' (' + quote(grant.column) + ') ON public.' + quote(grant.table) + ' TO ' + (grant.grantee==='PUBLIC'?'PUBLIC':quote(grant.grantee)) + (grant.grantable?' WITH GRANT OPTION':'') + ';');
    for (const fn of metadata.functions) sql.push('REVOKE ALL ON FUNCTION public.' + quote(fn.name) + '(' + fn.identity + ') FROM PUBLIC, anon, authenticated, service_role;');
    for (const grant of metadata.routineGrants || []) if (['PUBLIC','anon','authenticated','service_role','postgres'].includes(grant.grantee)) sql.push('GRANT ' + grant.privilege + ' ON FUNCTION public.' + quote(grant.name) + '(' + grant.identity + ') TO ' + (grant.grantee==='PUBLIC'?'PUBLIC':quote(grant.grantee)) + (grant.grantable?' WITH GRANT OPTION':'') + ';');
    for (const sequence of metadata.sequenceDetails || []) {
        if (sequence.owned_table && sequence.owned_column) sql.push('ALTER SEQUENCE public.' + quote(sequence.name) + ' OWNED BY public.' + quote(sequence.owned_table) + '.' + quote(sequence.owned_column) + ';');
        sql.push('REVOKE ALL ON SEQUENCE public.' + quote(sequence.name) + ' FROM PUBLIC, anon, authenticated, service_role;');
        for (const grant of sequence.grants || []) if (['PUBLIC','anon','authenticated','service_role','postgres'].includes(grant.grantee)) sql.push('GRANT ' + grant.privilege + ' ON SEQUENCE public.' + quote(sequence.name) + ' TO ' + (grant.grantee==='PUBLIC'?'PUBLIC':quote(grant.grantee)) + (grant.grantable?' WITH GRANT OPTION':'') + ';');
    }
    for (const table of metadata.realtime || []) sql.push('ALTER PUBLICATION supabase_realtime ADD TABLE public.' + quote(table) + ';');
    for (const item of metadata.replicaIdentity || []) if (item.identity !== 'd') sql.push('ALTER TABLE public.' + quote(item.table) + ' REPLICA IDENTITY ' + (item.identity === 'f' ? 'FULL' : item.identity === 'n' ? 'NOTHING' : 'USING INDEX ' + quote(item.index)) + ';');
    sql.push('COMMIT;');
    const result = sql.join('\n\n') + '\n';
    if (/jmjtqidirpmnegzvmiaq|freeupper-notifications|www\.freeupper\.com|-----BEGIN .*PRIVATE KEY/.test(result)) throw new Error('Production identifier/secret found in SQL');
    return result;
}
export async function prepare(ref, directory) {
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'supabase/staging/schema-metadata.json'), 'utf8'));
    const sql = schemaSQL(metadata, ref);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'schema.sql'), sql);
    return sql;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const refIndex = process.argv.indexOf('--project-ref');
    const outputIndex = process.argv.indexOf('--output');
    try {
        if (refIndex < 0 || outputIndex < 0) throw new Error('Usage: node scripts/prepare-staging-db.mjs --project-ref <staging-ref> --output <private-review-directory>');
        await prepare(process.argv[refIndex+1], path.resolve(process.argv[outputIndex+1]));
        console.log('Schema prepared locally. No database connection or SQL execution occurred.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
