import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const html=readFileSync('chat.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
let js=readFileSync('chat.js','utf8');
js=js.slice(0,js.lastIndexOf('    waitForSupabase(function(client)'))+`
    window.__chat = {
      seed(data) { currentUserId='self'; conversations=data.conversations; selectedConversationId=data.selected; messages=data.messages || []; },
      setClient(client) { sb=client; },
      setMessages(value) { messages=value; }, getMessages:()=>messages,
      setReply(value) { replyTargetMessage=value; renderReplyPreviewBar(); },
      switchTo(id) { stopActivity(); activitySession++; activityConnected=false; clearAllActivity(); selectedConversationId=id; messages=[]; },
      renderMessages, receiptHtml, replyPreviewInfo, replyThumbHtml, activitySummary,
      setupTypingChannel, startActivity, stopActivity, setActivityStage, applyActivityEvent, onRemoteTyping,
      session:()=>activitySession, entries:activityEntries, clearActivityFor,
      setChannel(channel) { typingChannel=channel; activityConnected=true; activityChannelConvId=selectedConversationId; },
      sendMixedMediaItems, sendMessageToConv, pushTemp,
      renderTypingIndicator, uploadRowHtml,
      setUpload(fn) { uploadToCloudinary=fn; },
      privateViewOnceEnabled, uploadToCloudinary
    };
})();`;
const convs=[{id:'a',otherUserId:'peer',otherUser:{id:'peer',display_name:'Ada'},is_group:false},
 {id:'b',otherUserId:'other',otherUser:{id:'other',display_name:'Bob'},is_group:false}];
const msg=(id,fields={})=>({id,conversation_id:'a',sender_id:'self',created_at:'2026-11-15T10:00:00Z',text:'Hello',message_type:'text',message_reads:[],...fields});
async function fixture(viewport,run){
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort()); // No production requests, credentials or writes.
  await page.setContent(html);
  await page.addScriptTag({content:readFileSync('js/freeupper-time.js','utf8')});
  await page.addScriptTag({content:'window.fuT=x=>x; window.FreeUpperSounds={};'});
  await page.addScriptTag({content:js});
  await page.evaluate(conversations=>{
   __chat.seed({conversations,selected:'a'});
   document.getElementById('conversationsSidebar').classList.add('hidden');
   document.getElementById('messageInput').disabled=false;
  },convs);
  await run(page);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
for(const width of [320,375,768,820,1280]) test('actual chat markup/rendering at '+width+'px',async()=>{
 await fixture({width,height:900},async page=>{
  await page.evaluate(rows=>{__chat.setMessages(rows);__chat.renderMessages();},[
   msg('text'), msg('voice',{message_type:'voice',media_url:'data:audio/webm;base64,',voice_duration:62}),
   msg('photo',{message_type:'media',metadata:{media_items:[{type:'image',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"/>'}]}}),
   msg('reply',{reply_to:'photo'}),msg('text')]);
  assert.equal(await page.locator('[data-msg-id="text"]').count(),1);
  assert.equal(await page.locator('.date-divider-row').count(),1);
  assert.equal(await page.locator('.date-divider-row').evaluate(e=>getComputedStyle(e).position),'static');
  assert.equal(await page.locator('.voice-wave .vw-bar').count(),32);
  assert.equal(await page.locator('[data-msg-id="reply"] .rp-thumb').count(),1);
  const overflow=await page.locator('.voice-msg').evaluate(e=>{const b=e.getBoundingClientRect();return [...e.children].some(c=>c.getBoundingClientRect().right>b.right+1);});
  assert.equal(overflow,false,'waveform and duration fit bubble');
  await page.evaluate(()=>{__chat.setChannel({send:()=>Promise.resolve()}); return __chat.applyActivityEvent({userId:'peer',kind:'recording'},__chat.session());});
  assert.match(await page.locator('#fuActivityBar').textContent(),/Ada is recording a voice note/);
  const layout=await page.evaluate(()=>{
   const area=document.getElementById('messagesArea').getBoundingClientRect();
   const bar=document.getElementById('fuActivityBar').getBoundingClientRect();
   const input=document.getElementById('messageInputArea').getBoundingClientRect();
   return {between:area.bottom<=bar.top+1 && bar.bottom<=input.top+1,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(layout.between,true); assert.equal(layout.overflow,false);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.act-wave i').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.locator('[data-reply-jump]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-msg-id="photo"]').evaluate(e=>e.classList.contains('flash-hit')),true);
 });
});
test('media upload retains destination/reply and stale callbacks cannot affect next room',async()=>{
 await fixture({width:390,height:844},async page=>{
  await page.evaluate(async()=>{
   window.writes=[]; window.events=[];
   __chat.setClient({from:()=>({insert(payload){writes.push(payload);return {select:()=>({single:async()=>({data:{...payload,id:'stored'},error:null})})};}})});
   __chat.setChannel({send:event=>{events.push(event);return Promise.resolve();}});
   __chat.setUpload((file,kind,progress)=>new Promise(resolve=>{window.finish=()=>resolve({url:'https://example.test/upload'});window.progress=progress;}));
   window.upload=__chat.sendMixedMediaItems([{url:'blob:fixture',kind:'image',file:{size:100,name:'x'}}],'caption',false,'a','original');
   progress(25);
  });
  assert.equal(await page.locator('.upl-pct').textContent(),'25%');
  await page.evaluate(async()=>{
   __chat.switchTo('b');
   __chat.setChannel({send:event=>{events.push({...event,room:'b'});return Promise.resolve();}});
   __chat.startActivity('recording');
   progress(75);finish();await upload;
  });
  const result=await page.evaluate(()=>({writes,events,messages:__chat.getMessages()}));
  assert.equal(result.writes.length,1); assert.equal(result.writes[0].conversation_id,'a');assert.equal(result.writes[0].reply_to,'original');
  assert.deepEqual(result.messages,[]);
  assert.equal(result.events.filter(e=>e.room==='b'&&e.payload.kind===null).length,0,'old completion does not stop next room recording');
 });
});
test('activity ignores old sessions, stop races, unknown peers; clears on disconnect and expiry',async()=>{
 await fixture({width:390,height:844},async page=>{
  const result=await page.evaluate(async()=>{
   __chat.setChannel({send:()=>Promise.resolve()});
   const old=__chat.session();__chat.switchTo('b');__chat.setChannel({send:()=>Promise.resolve()});
   await __chat.applyActivityEvent({userId:'other',kind:'photo'},old);
   const stale=__chat.entries().length;
   await __chat.applyActivityEvent({userId:'outsider',kind:'photo'},__chat.session());
   const unknown=__chat.entries().length;
   await __chat.applyActivityEvent({userId:'other',kind:'video'},__chat.session());
   const active=__chat.entries().length;
   __chat.clearActivityFor('other');
   return {stale,unknown,active,cleared:__chat.entries().length};
  });
  assert.deepEqual(result,{stale:0,unknown:0,active:1,cleared:0});
  await page.clock.install();
  await page.evaluate(()=>__chat.applyActivityEvent({userId:'other',kind:'video'},__chat.session()));
  await page.clock.fastForward(7100);
  assert.equal(await page.locator('#fuActivityBar').isVisible(),false);
 });
});

test('sending/sent/read receipts, all reply media variants and group wording',async()=>{
 await fixture({width:390,height:844},async page=>{
  const result=await page.evaluate(()=>({
   receipts:[{id:'temp-1'},{id:'1',message_reads:[]},{id:'2',message_reads:[{user_id:'self'}]},
    {id:'3',message_reads:[{user_id:'peer'}]},{id:'temp-2',failed:true}].map(__chat.receiptHtml),
   previews:[
    {message_type:'media',metadata:{media_items:[{type:'video',url:'https://x/video/upload/a.mp4'},{type:'image',url:'https://x/b.jpg'}]}},
    {message_type:'media',metadata:{view_once:true,media_items:[{type:'image',url:'secret'}]}},
    {message_type:'document',metadata:{name:'Report.pdf'}},
    {message_type:'poll',poll_data:'{"question":"Lunch?"}'},
    {message_type:'image',media_urls:['one','two']}
   ].map(__chat.replyPreviewInfo),
   group:__chat.activitySummary([{uid:'1',name:'Ada',kind:'recording'},{uid:'2',name:'Bob',kind:'recording'},{uid:'3',name:'Cy',kind:'recording'}])
  }));
  assert.match(result.receipts[0],/Sending/);assert.match(result.receipts[1],/Sent/);assert.doesNotMatch(result.receipts[2],/class="read-receipt read"/);
  assert.match(result.receipts[3],/Seen by a recipient/);assert.equal(result.receipts[4],'');assert.ok(result.receipts.every(r=>!r.includes('Delivered')));
  assert.equal(result.previews[0].video,true);assert.equal(result.previews[0].count,2);assert.equal(result.previews[1].thumb,'');
  assert.equal(result.previews[2].label,'📄 Report.pdf');assert.equal(result.previews[3].label,'📊 Lunch?');assert.equal(result.previews[4].count,2);
  assert.equal(result.group,'Ada, Bob and Cy are recording voice notes…');
 });
});

test('upload failure and explicit cancellation clear activity and never insert a message',async()=>{
 await fixture({width:390,height:844},async page=>{
  await page.evaluate(async()=>{
   window.writes=[]; window.events=[];
   __chat.setChannel({send:event=>{events.push(event);return Promise.resolve();}});
   __chat.setUpload(async()=>{throw new Error('Network offline');});
   await __chat.sendMixedMediaItems([{url:'blob:fixture',kind:'video',file:{size:100}}],'',false,'a');
  });
  assert.equal(await page.locator('.upl-row').count(),0);
  assert.equal(await page.evaluate(()=>events.at(-1).payload.kind),null);
  await page.evaluate(async()=>{
   __chat.setUpload((file,kind,progress,signal)=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')));
   }));
   window.upload=__chat.sendMixedMediaItems([{url:'blob:fixture',kind:'image',file:{size:100}}],'',false,'a');
   const id=__chat.getMessages().find(m=>m.uploading).id;
   cancelMediaUpload(id); await upload;
  });
  assert.equal(await page.locator('.upl-row').count(),0);
  assert.equal(await page.evaluate(()=>events.at(-1).payload.kind),null);
 });
});

test('private channel auth, disconnect/reconnect, and delayed profile stop races',async()=>{
 await fixture({width:390,height:844},async page=>{
  const result=await page.evaluate(async()=>{
   window.authCalls=0; window.channelOptions=null; window.reconnectEvents=[];
   __chat.setClient({realtime:{setAuth:async()=>{authCalls++;}},removeChannel:async()=>{},
    channel:(topic,options)=>{
     channelOptions={topic,...options};
     return {on(){return this;},subscribe(cb){window.channelStatus=cb;cb('SUBSCRIBED');return this;},send:async event=>{reconnectEvents.push(event);}};
    }});
   await __chat.setupTypingChannel('a');
   await __chat.onRemoteTyping({userId:'peer',isTyping:true},__chat.session());
   const typing=__chat.entries().length;
   __chat.startActivity('recording');
   channelStatus('CHANNEL_ERROR');
   const disconnected=__chat.entries().length;
   channelStatus('SUBSCRIBED');
   await __chat.onRemoteTyping({userId:'peer',isTyping:true},__chat.session());
   const reconnected=__chat.entries().length;
   __chat.clearActivityFor('peer');
   return {authCalls,channelOptions,typing,disconnected,reconnected,resumed:reconnectEvents.filter(e=>e.payload.kind==='recording').length};
  });
  assert.equal(result.authCalls,1);assert.equal(result.channelOptions.topic,'chat-activity:a');assert.equal(result.channelOptions.config.private,true);
  assert.equal(result.typing,1);assert.equal(result.disconnected,0);assert.equal(result.reconnected,1);assert.equal(result.resumed,2);
  const race=await page.evaluate(async()=>{
   __chat.seed({selected:'a',conversations:[{id:'a',otherUserId:'peer',is_group:false}],messages:[]});
   __chat.setClient({from:()=>({select(){return this;},eq(){return this;},maybeSingle:()=>new Promise(resolve=>window.resolveProfile=resolve)})});
   const incoming=__chat.applyActivityEvent({userId:'peer',kind:'photo'},__chat.session());
   await __chat.applyActivityEvent({userId:'peer',kind:null},__chat.session());
   resolveProfile({data:{id:'peer',display_name:'Ada'}});await incoming;
   return __chat.entries().length;
  });
  assert.equal(race,0,'stop invalidates in-flight profile lookup');
 });
});

test('tabs scroll horizontally, support arrows/Home/End and preserve composer keyboard input',async()=>{
 await fixture({width:320,height:844},async page=>{
  await page.evaluate(()=>document.getElementById('conversationsSidebar').classList.remove('hidden'));
  await page.locator('#clTab-all').focus();
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.id),'clTab-requests');
  await page.keyboard.press('Enter');assert.equal(await page.locator('#conversationList').getAttribute('aria-labelledby'),'clTab-requests');
  await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.id),'clTab-all');
  await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.id),'clTab-requests');
  assert.equal(await page.locator('#clTabs').evaluate(e=>e.scrollWidth>e.clientWidth),true);
  await page.evaluate(()=>document.getElementById('conversationsSidebar').classList.add('hidden'));
  await page.locator('#messageInput').fill('hello');await page.keyboard.press('Home');await page.keyboard.type('A');
  assert.equal(await page.locator('#messageInput').inputValue(),'Ahello');
 });
});

test('actual Cloudinary helper emits only computable XHR progress and supports abort',async()=>{
 await fixture({width:390,height:844},async page=>{
  const result=await page.evaluate(async()=>{
   const original=window.XMLHttpRequest;
   window.XMLHttpRequest=class {
    constructor(){this.upload=new EventTarget();window.fakeXHR=this;}
    open(){} send(){} abort(){this.onabort();this.onloadend();}
   };
   try{
    const pcts=[];const upload=__chat.uploadToCloudinary(new Blob(['file']),'image',pct=>pcts.push(pct));
    fakeXHR.upload.dispatchEvent(new ProgressEvent('progress',{lengthComputable:false,loaded:10,total:100}));
    const initial=pcts.length;
    fakeXHR.upload.dispatchEvent(new ProgressEvent('progress',{lengthComputable:true,loaded:25,total:100}));
    fakeXHR.status=200;fakeXHR.responseText='{"secure_url":"https://example.test/upload"}';fakeXHR.onload();fakeXHR.onloadend();
    const stored=await upload;
    const controller=new AbortController();
    const cancelled=__chat.uploadToCloudinary(new Blob(['file']),'image',null,controller.signal).catch(e=>e.name);
    controller.abort();
    return {initial,pcts,stored,cancelled:await cancelled};
   }finally{window.XMLHttpRequest=original;}
  });
  assert.equal(result.initial,0);assert.deepEqual(result.pcts,[25]);assert.equal(result.stored.url,'https://example.test/upload');assert.equal(result.cancelled,'AbortError');
 });
});

test('voice recording broadcasts on start and clears on cancel/send with immutable destination',async()=>{
 await fixture({width:390,height:844},async page=>{
  const result=await page.evaluate(async()=>{
   window.events=[];window.writes=[];window.tracksStopped=0;
   __chat.setChannel({send:event=>{events.push(event);return Promise.resolve();}});
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>tracksStopped++}]})}});
   window.AudioContext=class {
    createMediaStreamSource(){return {connect(){}};}
    createAnalyser(){return {fftSize:512,frequencyBinCount:256,getByteTimeDomainData(data){data.fill(128);}};}
    close(){return Promise.resolve();}
   };
   window.MediaRecorder=class {
    constructor(){this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});window.recordingStop=this.onstop();}
   };
   __chat.setUpload(async()=>({url:'https://example.test/voice'}));
   __chat.setClient({from:()=>({insert(payload){writes.push(payload);return {select:()=>({single:async()=>({data:{...payload,id:'voice'},error:null})})};}})});
   await startVoiceRecording();cancelVoiceRecording();await recordingStop;
   const cancelledWrites=writes.length;
   await startVoiceRecording();sendVoiceRecording();
   __chat.switchTo('b');await recordingStop;
   return {events,writes,tracksStopped,cancelledWrites};
  });
  assert.equal(result.cancelledWrites,0);assert.equal(result.tracksStopped,2);assert.equal(result.writes.length,1);
  assert.equal(result.writes[0].conversation_id,'a');assert.equal(result.writes[0].message_type,'voice');
  assert.equal(result.events.filter(e=>e.payload.kind==='recording').length,2);
  assert.equal(result.events.filter(e=>e.event==='activity'&&e.payload.kind===null).length,2);
 });
});

test('date ordering/de-duplication and thumbnail attribute escaping',async()=>{
 await fixture({width:390,height:844},async page=>{
  await page.evaluate(rows=>{__chat.setMessages(rows);__chat.renderMessages();},[
   msg('later',{created_at:'2026-11-15T12:00:00Z'}),msg('earlier',{created_at:'2026-11-14T12:00:00Z'}),
   msg('same-day',{created_at:'2026-11-15T10:00:00Z'}),msg('later',{created_at:'2026-11-15T12:00:00Z'})]);
  assert.equal(await page.locator('.date-divider-row').count(),2);
  assert.deepEqual(await page.locator('[data-msg-id]').evaluateAll(es=>es.map(e=>e.dataset.msgId)),['earlier','same-day','later']);
  assert.equal(await page.evaluate(()=>{
   const node=document.createElement('div');node.innerHTML=__chat.replyThumbHtml({thumb:'x" onload="window.injected=true',count:1});
   return node.querySelector('img').hasAttribute('onload');
  }),false);
 });
});
