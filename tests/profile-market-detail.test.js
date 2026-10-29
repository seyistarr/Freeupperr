import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../market.js',import.meta.url),'utf8');
const loader=source.slice(source.indexOf('    async function loadMarketListings('),source.indexOf('    // ─── SKELETONS'));
const entry=source.slice(source.indexOf('    window.openProfileListing ='),source.indexOf('    window.openProductModal ='));
test('Profile listing detail loads the exact authorized active item before opening',async()=>{
 const calls=[];let listing={id:'outside-first-page',status:'active',title:'Item',price:42,images:[{url:'https://example.com/photo.jpg'}],profiles:{display_name:'Seller'},market_categories:{name:'Art'}};
 const context={window:{ListingsAPI:{getListing:async id=>{calls.push(id);return listing;},getListings:()=>{throw Error('Unexpected bulk request');}}},console:{error(){}},openProductModal:id=>calls.push('open:'+id)};
 vm.createContext(context);vm.runInContext('let marketListings=[];'+loader+entry,context);
 assert.equal(await context.window.openProfileListing('outside-first-page'),true);assert.deepEqual(calls,['outside-first-page','open:outside-first-page']);
 assert.equal(vm.runInContext('marketListings[0].seller',context),'Seller');assert.equal(vm.runInContext('marketListings[0].images[0]',context),'https://example.com/photo.jpg');
 for(const status of ['sold','draft']){listing={...listing,status};assert.equal(await context.window.openProfileListing(listing.id),false);}
 context.window.ListingsAPI.getListing=async()=>{throw Error('Denied by RLS');};assert.equal(await context.window.openProfileListing(listing.id),false);
 assert.equal(calls.filter(v=>v.startsWith('open:')).length,1);
});
