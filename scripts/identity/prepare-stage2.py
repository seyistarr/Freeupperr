#!/usr/bin/env python3
"""Generate a review-only Stage 2 artifact from email-free, read-only evidence."""
import argparse,collections,csv,json,pathlib,re,hashlib
p=argparse.ArgumentParser();p.add_argument('fields');p.add_argument('posts');p.add_argument('--output',required=True);p.add_argument('--report',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];fields=json.load(open(a.fields));posts=json.load(open(a.posts))
confirmed=[x for x in fields if x['decision']=='confirmed_exact_verified_email'];assert confirmed,'No confirmed fields'
q=lambda v:"'"+v.replace("'","''")+"'"
for x in confirmed:
 assert re.fullmatch(r'FU[0-9A-F]{12}',x['freeupper_id']) and re.fullmatch(r'[a-f0-9]{64}',x['guard_token'])
 assert x['field'] in ('username','display_name','display_username') and '@' not in x['proposed_value']
for x in posts:assert re.fullmatch(r'[a-f0-9-]{36}',x['post_id']) and re.fullmatch(r'[a-f0-9]{64}',x['guard_token']) and x['expected_references']>0
sql=(root/'docs/identity/stage2-apply.template.sql').read_text()
values=','.join('('+','.join(q(x[k]) for k in ('freeupper_id','field','guard_token'))+')' for x in confirmed)
sql=sql.replace('-- APPROVED_FIELD_MANIFEST','INSERT INTO approved_identity_fields VALUES\n'+values+';')
if posts:
 values=','.join('('+q(x['post_id'])+','+q(x['guard_token'])+','+str(x['expected_references'])+')' for x in posts)
 sql=sql.replace('-- APPROVED_POST_MANIFEST','INSERT INTO approved_mention_posts VALUES\n'+values+';')
sql=sql.replace('-- REF_REWRITE_HELPERS',(root/'docs/identity/stage2-mentions.sql').read_text()).replace('-- REF_REWRITE_AND_GUARDS','')
pathlib.Path(a.output).write_text(sql)
with open(a.report,'w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=['freeupper_id','field','decision','proposed_value']);w.writeheader();w.writerows({k:x.get(k) for k in w.fieldnames} for x in fields)
print(json.dumps({'confirmed_fields':dict(collections.Counter(x['field'] for x in confirmed)),'confirmed_profiles':len({x['freeupper_id'] for x in confirmed}),'ambiguous_fields':sum(x['decision']=='ambiguous_at_value' for x in fields),'ambiguous_profiles':len({x['freeupper_id'] for x in fields if x['decision']=='ambiguous_at_value'}),'posts':len(posts),'reference_entries':sum(x['expected_references'] for x in posts),'sha256':hashlib.sha256(sql.encode()).hexdigest(),'ends_with':'ROLLBACK','executed':False}))
