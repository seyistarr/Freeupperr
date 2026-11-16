import test from 'node:test';
import assert from 'node:assert/strict';
import {builtGalleryHarness,owner} from './helpers/gallery-built-fixture.js';

// Compare the actual built owner UI with public identity routes, rather than
// duplicating the approved design in a second renderer or a mocked stylesheet.
const routes=['/profile?uid='+owner,'/@fixture_creator','/u/FUABCDEF123456','/u/FUABCDEF123456/','/@fixture_creator/'];
async function styles(locator){
 return locator.evaluateAll(elements=>elements.map(el=>{
  const s=getComputedStyle(el);
  return Object.fromEntries(['display','position','fontFamily','fontSize','fontWeight','lineHeight','color','gap','padding','margin','borderBottom','objectFit','gridTemplateColumns'].map(k=>[k,s[k]]));
 }));
}
for(const width of [390,1280])test(`owner, visitor and guest share built Notes/Gallery styles at ${width}px`,{timeout:180000},async()=>{
 let approved;
 for(const role of ['owner','visitor','guest']){
  const h=await builtGalleryHarness({authenticated:role!=='guest',viewerId:role==='visitor'?'55555555-5555-4555-8555-555555555555':owner,viewport:{width,height:900}});
  const {page}=h;
  try{
   for(const route of routes){
    const label=role+' '+route;
    await page.goto(h.origin+route ,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.profile-content-tabs');
    await page.waitForFunction(()=>document.querySelector('iframe[title="Profile Notes"]')?.contentDocument?.querySelector('.feed-post'));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('is-owner')),role==='owner',label);
    if(role==='owner')assert.equal(await page.locator('#actionRow button').count(),0,label);
    else {
     await page.locator('#actionRow .act-follow').waitFor();
     assert.equal(await page.locator('#actionRow .act-msg').textContent(),'Message',label);
     assert.equal(await page.locator('#tabsBar [data-tab="star"]').isVisible(),false,label);
    }
    assert.equal(await page.evaluate(()=>typeof FreeUpperInlineVideo?.play),'function',label);
    const nav=page.locator('#panel-posts .profile-content-tabs');
    assert.equal(await nav.evaluate(el=>getComputedStyle(el).display),'flex',label);
    const notes=page.frameLocator('iframe[title="Profile Notes"]');
    const snapshot={
     nav:await styles(nav),tabs:await styles(nav.locator('button')),
     card:await styles(notes.locator('.feed-post')),
     author:await styles(notes.locator('.feed-post [data-author-name]')),
     actions:await styles(notes.locator('.feed-post .post-actions-row')),
     frame:await styles(page.locator('iframe[title="Profile Notes"]')),
    };
    assert.equal(await nav.locator('[aria-selected="true"]').evaluate(el=>getComputedStyle(el).borderBottomColor),'rgb(124, 58, 237)',label);
    await nav.getByRole('tab',{name:'Gallery',exact:true}).click();
    await page.waitForSelector('[data-gallery-index]');
    snapshot.galleryTabs=await styles(nav.locator('button'));
    snapshot.grid=await styles(page.locator('#panel-posts .grid-3'));
    snapshot.preview=await styles(page.locator('#panel-posts .gallery-preview').first());
    assert.equal(await page.locator('[data-gallery-index]').count(),5,label);
    await page.locator('[data-gallery-index]').first().click();
    await page.waitForSelector('.gallery-overlay iframe');
    const frame=await (await page.locator('.gallery-overlay iframe').elementHandle()).contentFrame();
    await frame.waitForFunction(id=>window.FreeUpperVideoPlayer?.snapshot()?.post===id,h.posts[0].id);
    snapshot.overlay=await styles(page.locator('.gallery-overlay'));
    assert.equal(await page.locator('.gallery-overlay').evaluate(el=>el.getBoundingClientRect().width),width,label);
    await page.locator('.gallery-close').click();
    await page.waitForFunction(()=>!document.querySelector('.gallery-overlay'));
    assert.equal(await nav.locator('[aria-selected="true"]').textContent(),'Gallery',label);
    if(!approved)approved=snapshot;
    else assert.deepEqual(snapshot,approved,label);
    assert.deepEqual(h.errors,[],label);
   }
  }finally{await h.close();}
 }
});
