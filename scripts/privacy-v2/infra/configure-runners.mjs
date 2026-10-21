#!/usr/bin/env node
// Generates reviewable AWS/GitHub configuration; never calls a provisioning API.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function validateConfiguration(c){
 if(c?.repository!=='seyistarr/Freeupperr'||!Array.isArray(c.reviewers)||!c.reviewers.length||c.reviewers.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Repository and required reviewer IDs required');
 for(const runner of ['first','second']){
  const r=c[runner];
  if(!/^[0-9]{12}$/.test(r?.account||'')||!/^freeupper-staging-revocation-[a-z0-9-]{3,35}$/.test(r.bucket||'')||!['us-east-2','eu-west-1'].includes(r.region))throw Error('Isolated account, staging bucket and supported region required');
 }
 if(c.first.account===c.second.account||c.first.bucket===c.second.bucket||c.first.region===c.second.region)throw Error('Independent accounts, buckets and regions required');
 return c;
}
export function runnerTemplate(c,runner){
 validateConfiguration(c);const r=c[runner],role=`freeupper-staging-revocation-${runner}`,environment=`privacy-v2-revocation-${runner}`;
 const bucketArn='arn:aws:s3:::'+r.bucket, firstArn='arn:aws:s3:::'+c.first.bucket;
 const readActions=['s3:GetObject','s3:GetObjectVersion','s3:GetObjectRetention','s3:GetObjectLegalHold'];
 const statements=[{Effect:'Allow',Action:['s3:GetBucketObjectLockConfiguration'],Resource:bucketArn},
  {Effect:'Allow',Action:['s3:PutObject'],Resource:[bucketArn+`/privacy-v2/${runner}.json`,bucketArn+`/privacy-v2/failed/${runner}-*`]},
  {Effect:'Allow',Action:readActions,Resource:[bucketArn+`/privacy-v2/${runner}.json`,bucketArn+`/privacy-v2/failed/${runner}-*`]}];
 if(runner==='second')statements.push({Effect:'Allow',Action:readActions,Resource:firstArn+'/privacy-v2/first.json'});
 const policy=[{Sid:'TLSOnly',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[bucketArn,bucketArn+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}}];
 if(runner==='first')policy.push({Sid:'IndependentSecondRead',Effect:'Allow',Principal:{AWS:`arn:aws:iam::${c.second.account}:role/freeupper-staging-revocation-second`},Action:readActions,Resource:bucketArn+'/privacy-v2/first.json'});
 const template={AWSTemplateFormatVersion:'2010-09-09',Description:'Isolated synthetic staging evidence only; retain immutable resources',Resources:{
  Evidence:{Type:'AWS::S3::Bucket',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{BucketName:r.bucket,ObjectLockEnabled:true,
   VersioningConfiguration:{Status:'Enabled'},ObjectLockConfiguration:{ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{Mode:'COMPLIANCE',Days:90}}},
   OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},BucketEncryption:{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
   PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}}},
  EvidencePolicy:{Type:'AWS::S3::BucketPolicy',Properties:{Bucket:{Ref:'Evidence'},PolicyDocument:{Version:'2012-10-17',Statement:policy}}},
  RunnerRole:{Type:'AWS::IAM::Role',Properties:{RoleName:role,MaxSessionDuration:3600,AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:`arn:aws:iam::${r.account}:oidc-provider/token.actions.githubusercontent.com`},Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':`repo:${c.repository}:environment:${environment}`}}}]},Policies:[{PolicyName:'OwnImmutableSyntheticEvidence',PolicyDocument:{Version:'2012-10-17',Statement:statements}}]}}},Outputs:{RoleArn:{Value:{'Fn::GetAtt':['RunnerRole','Arn']}},Bucket:{Value:{Ref:'Evidence'}}}};
 template.Conditions={IsolatedAccountAndRegion:{'Fn::And':[{'Fn::Equals':[{Ref:'AWS::AccountId'},r.account]},{'Fn::Equals':[{Ref:'AWS::Region'},r.region]}]}};
 for(const value of Object.values(template.Resources))value.Condition='IsolatedAccountAndRegion';
 for(const value of Object.values(template.Outputs))value.Condition='IsolatedAccountAndRegion';
 return template;
}
async function main(){
 const [file,out]=process.argv.slice(2);if(!file||!out||!/^[A-Za-z0-9_./-]+$/.test(out))throw Error('Provide nonsecret configuration JSON and output directory');
 const c=validateConfiguration(JSON.parse(await readFile(file,'utf8')));await mkdir(out,{recursive:true});
 for(const runner of ['first','second']){
  const env=`privacy-v2-revocation-${runner}`,r=c[runner];
  await writeFile(`${out}/${runner}-stack.json`,JSON.stringify(runnerTemplate(c,runner),null,2));
  await writeFile(`${out}/${runner}-environment.json`,JSON.stringify({prevent_self_review:true,reviewers:c.reviewers.map(id=>({type:'User',id})),deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},null,2));
  const vars={REVOCATION_FIRST_ACCOUNT:c.first.account,REVOCATION_SECOND_ACCOUNT:c.second.account,REVOCATION_EVIDENCE_BUCKET:r.bucket,REVOCATION_ROLE_ARN:`arn:aws:iam::${r.account}:role/freeupper-staging-revocation-${runner}`,REVOCATION_REGION:r.region,...(runner==='second'?{REVOCATION_FIRST_BUCKET:c.first.bucket}:{})};
  await writeFile(`${out}/${runner}-variables.json`,JSON.stringify(vars,null,2));
  await writeFile(`${out}/${runner}-aws.sh`,['#!/usr/bin/env bash','set -euo pipefail',
   'profile="${FREEUPPER_'+runner.toUpperCase()+'_AWS_PROFILE:?Set an isolated staging AWS profile}"',
   'actual=$(aws sts get-caller-identity --profile "$profile" --query Account --output text)',
   `test "$actual" = '${r.account}' || { echo 'Wrong isolated account' >&2; exit 1; }`,
   `aws iam get-open-id-connect-provider --profile "$profile" --open-id-connect-provider-arn arn:aws:iam::${r.account}:oidc-provider/token.actions.githubusercontent.com >/dev/null`,
   `aws cloudformation validate-template --profile "$profile" --region ${r.region} --template-body 'file://${out}/${runner}-stack.json' >/dev/null`,
   `aws cloudformation deploy --profile "$profile" --region ${r.region} --stack-name freeupper-staging-revocation-${runner} --template-file '${out}/${runner}-stack.json' --capabilities CAPABILITY_NAMED_IAM`
  ].join('\n')+'\n');
  await writeFile(`${out}/${runner}-github.sh`,['#!/usr/bin/env bash','set -euo pipefail',`gh api --method PUT repos/${c.repository}/environments/${env} --input '${out}/${runner}-environment.json'`,`gh api --method POST repos/${c.repository}/environments/${env}/deployment-branch-policies -f name=feature/post-privacy-v2-integration -f type=branch`,...Object.entries(vars).map(([key,value])=>`gh variable set ${key} --repo ${c.repository} --env ${env} --body '${value}'`)].join('\n')+'\n');
 }
 console.log('Generated review files only. Deploy second stack first; then first (cross-account role principal must exist).');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Runner configuration rejected; no resources provisioned.');process.exitCode=1;});
