#!/usr/bin/env python3
"""Restore catalog-only production application DDL into the task's local database.
Requires real GoTrue to have initialized auth first. Never reads application rows.
"""
import argparse,json,subprocess,pathlib
p=argparse.ArgumentParser();p.add_argument('snapshot');p.add_argument('--output',required=True);a=p.parse_args()
s=json.load(open(a.snapshot));q=lambda v:'"'+v.replace('"','""')+'"'
qual=lambda v:'.'.join(q(x) for x in (v.split('.') if '.' in v else ['public',v]))
out=['BEGIN;','SET search_path=public,extensions;','SET check_function_bodies=off;','CREATE EXTENSION IF NOT EXISTS vector;','CREATE EXTENSION IF NOT EXISTS pg_trgm;','CREATE SCHEMA IF NOT EXISTS privacy_v2_private;','CREATE SCHEMA IF NOT EXISTS otd;']
identity_sequences={t['table'].replace('public.','').split('.')[-1]+'_'+c['name']+'_seq' for t in s['tables'] for c in t['columns'] if c['identity']}
for r in s['roles']:
 if r['name']!='postgres':out.append('ALTER ROLE '+q(r['name'])+(' BYPASSRLS;' if r['bypassrls'] else ' NOBYPASSRLS;'))
for seq in s['sequences']:
 if seq['sequencename'] in identity_sequences:continue
 out.append(f"CREATE SEQUENCE {q(seq['schemaname'])}.{q(seq['sequencename'])} AS {seq['data_type']} INCREMENT BY {seq['increment_by']} MINVALUE {seq['min_value']} MAXVALUE {seq['max_value']} START WITH {seq['start_value']} CACHE {seq['cache_size']} {'CYCLE' if seq['cycle'] else 'NO CYCLE'};")
for t in s['tables']:
 columns=[]
 for c in t['columns']:
  v=q(c['name'])+' '+c['type']
  if c['identity']:v+=' GENERATED '+('ALWAYS' if c['identity']=='a' else 'BY DEFAULT')+' AS IDENTITY'
  elif c['generated']:v+=' GENERATED ALWAYS AS ('+c['default']+') STORED'
  elif c['default'] is not None:v+=' DEFAULT '+c['default']
  if c['notnull']:v+=' NOT NULL'
  columns.append(v)
 out.append('CREATE TABLE '+qual(t['table'])+' ('+','.join(columns)+');')
out.extend(f+';' for f in s['auth']['functions'])
for f in s['functions']:out.append(f['definition']+';')
for c in sorted(s['constraints'],key=lambda c:c['type']=='f'):
 out.append('ALTER TABLE '+qual(c['table'])+' ADD CONSTRAINT '+q(c['name'])+' '+c['definition']+';')
for i in s['indexes']:out.append(i['definition']+';')
for v in s['views']:
 opts=' WITH ('+','.join(v['options'])+')' if v['options'] else ''
 out.append('CREATE '+('MATERIALIZED ' if v['kind']=='m' else '')+'VIEW '+q(v['schema'])+'.'+q(v['name'])+opts+' AS '+v['definition']+';')
for t in s['triggers']:out.append(t['definition']+';')
for t in s['tables']:
 if t['rls']:out.append('ALTER TABLE '+qual(t['table'])+' ENABLE ROW LEVEL SECURITY;')
 if t['force_rls']:out.append('ALTER TABLE '+qual(t['table'])+' FORCE ROW LEVEL SECURITY;')
for pol in s['policies']:
 sql='CREATE POLICY '+q(pol['policyname'])+' ON '+q(pol['schemaname'])+'.'+q(pol['tablename'])+' AS '+pol['permissive']+' FOR '+pol['cmd']+' TO '+','.join('PUBLIC' if r=='public' else q(r) for r in pol['roles'])
 if pol['qual']:sql+=' USING ('+pol['qual']+')'
 if pol['with_check']:sql+=' WITH CHECK ('+pol['with_check']+')'
 out.append(sql+';')
for g in s['grants']:
 out.append('GRANT '+g['privilege_type']+' ON TABLE '+q(g['table_schema'])+'.'+q(g['table_name'])+' TO '+('PUBLIC' if g['grantee']=='PUBLIC' else q(g['grantee']))+(' WITH GRANT OPTION' if g['is_grantable']=='YES' else '')+';')
# Table grants do not imply restricted-column grants; preserve each explicitly.
for g in s['column_grants']:
 out.append('GRANT '+g['privilege_type']+' ('+q(g['column_name'])+') ON TABLE '+q(g['table_schema'])+'.'+q(g['table_name'])+' TO '+q(g['grantee'])+(' WITH GRANT OPTION' if g['is_grantable']=='YES' else '')+';')
def acl_entries(acl):
 if acl is None:return []
 return [x.strip('"').split('/',1)[0].split('=',1) for x in acl[1:-1].split(',')]
for f in s['functions']:
 target=q(f['schema'])+'.'+q(f['name'])+'('+f['identity_args']+')'
 out.append('REVOKE ALL ON FUNCTION '+target+' FROM PUBLIC;')
 for role,priv in (acl_entries(f['acl']) if f['acl'] is not None else [('', 'X')]):
  if 'X' in priv:out.append('GRANT EXECUTE ON FUNCTION '+target+' TO '+(q(role) if role else 'PUBLIC')+(' WITH GRANT OPTION' if '*' in priv else '')+';')
for schema in s['schema_grants']:
 out.append('REVOKE ALL ON SCHEMA '+q(schema['name'])+' FROM PUBLIC;')
 for role,priv in acl_entries(schema['acl']):
  ps=','.join(name for code,name in [('U','USAGE'),('C','CREATE')] if code in priv)
  if ps:out.append('GRANT '+ps+' ON SCHEMA '+q(schema['name'])+' TO '+(q(role) if role else 'PUBLIC')+';')
# Restore captured schema-specific defaults for future migrations, without granting
# anything in private schemas that the source did not grant.
for entry in s.get('default_acls',[]):
 if entry['schema'] not in ('public','privacy_v2_private','otd'):continue
 kind={'r':'TABLES','f':'FUNCTIONS','S':'SEQUENCES'}.get(entry['kind'])
 if not kind:continue
 prefix='ALTER DEFAULT PRIVILEGES FOR ROLE '+q(entry['owner'])+' IN SCHEMA '+q(entry['schema'])
 out.append(prefix+' REVOKE ALL ON '+kind+' FROM PUBLIC,anon,authenticated,service_role;')
 mapping={'r':{'a':'INSERT','r':'SELECT','w':'UPDATE','d':'DELETE','D':'TRUNCATE','x':'REFERENCES','t':'TRIGGER','m':'MAINTAIN'},'f':{'X':'EXECUTE'},'S':{'r':'SELECT','w':'UPDATE','U':'USAGE'}}[entry['kind']]
 for role,priv in acl_entries(entry['acl']):
  ps=','.join(name for code,name in mapping.items() if code in priv)
  if ps:out.append(prefix+' GRANT '+ps+' ON '+kind+' TO '+(q(role) if role else 'PUBLIC')+';')
for membership in s.get('role_memberships',[]):
 if membership['role']!='postgres':out.append('GRANT '+q(membership['role'])+' TO '+q(membership['member'])+(' WITH ADMIN OPTION' if membership['admin'] else '')+';')
out.append('COMMIT;');pathlib.Path(a.output).write_text('\n'.join(out)+'\n')
print(json.dumps({'tables':len(s['tables']),'functions':len(s['functions']),'constraints':len(s['constraints']),'policies':len(s['policies']),'triggers':len(s['triggers']),'output':a.output}))
