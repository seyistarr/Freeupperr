import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewProtectedMedia as can } from '../api/post-media-authorization.js';
const base={viewerId:'viewer',authorId:'author',visibility:'public',authorPrivate:false,authorSuspended:false,isDeleted:false,isHidden:false,followsAuthor:false,authorFollowsViewer:false};
const cases=[
 ['public stranger',{},true],
 ['private stranger',{authorPrivate:true},false],
 ['private approved follower',{authorPrivate:true,followsAuthor:true},true],
 ['pending follower',{authorPrivate:true,followsAuthor:false},false],
 ['followers approved',{visibility:'followers',followsAuthor:true},true],
 ['friends one-way',{visibility:'friends',followsAuthor:true},false],
 ['friends mutual',{visibility:'friends',followsAuthor:true,authorFollowsViewer:true},true],
 ['only me stranger',{visibility:'only_me',followsAuthor:true},false],
 ['only me owner',{visibility:'only_me',viewerId:'author'},true],
 ['deleted owner',{visibility:'only_me',viewerId:'author',isDeleted:true},false],
 ['hidden post',{isHidden:true},false],
 ['suspended author',{authorSuspended:true},false],
 ['null visibility',{visibility:null},false],
 ['null privacy',{authorPrivate:null},false],
 ['anonymous on private',{viewerId:null,authorPrivate:true,followsAuthor:true},false]
];
for(const [name,overrides,expected] of cases) test(name,()=>assert.equal(can({...base,...overrides}),expected));
