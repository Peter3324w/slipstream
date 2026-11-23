import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TemporaryDvr } from '../src/main/dvr.ts'

const epoch = Date.parse('2026-11-22T12:00:00Z')
const master = (suffix = '') => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO="source"\nhttps://stream.test/live${suffix}.m3u8\n`
const media = (first, count = 3, end = false) => '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:' + first + '\n' + Array.from({length:count}, (_,i) => `#EXT-X-PROGRAM-DATE-TIME:${new Date(epoch+(first+i)*10000).toISOString()}\n${first+i===2?'#EXT-X-DISCONTINUITY\n':''}#EXTINF:10,\nhttps://stream.test/${first+i}.ts\n`).join('') + (end?'#EXT-X-ENDLIST\n':'')
async function fixture(t, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'slipstream-dvr-test-'))
  const root = join(parent,'recordings')
  const dvr = new TemporaryDvr(root, { pollMs: 5, ...options })
  t.after(async () => { await dvr.dispose(); await rm(parent,{recursive:true,force:true}) })
  await dvr.initialize()
  return {dvr, root, parent}
}
async function until(fn) { for(let i=0;i<1000;i++){ if(await fn()) return; await new Promise(r=>setTimeout(r,5)) } assert.fail('condition timed out') }
const playlistUrl = result => result.masterPlaylist.split('\n').find(l=>l.startsWith('http:'))

test('recording publishes saved media, exact paused offset, dates and authorized loopback routes', async t => {
  const {dvr} = await fixture(t,{fetch:async url => new Response(String(url).endsWith('.ts')?'video':media(0))})
  const result = await dvr.start(master(),'source',epoch+12500)
  assert.equal(result.startAt,2.5)
  const url=playlistUrl(result)
  assert.match(url,/^http:\/\/127\.0\.0\.1:/)
  const response=await fetch(url)
  assert.equal(response.headers.get('access-control-allow-origin'),'*')
  const text=await response.text()
  assert.match(text,/#EXT-X-DISCONTINUITY/)
  assert.match(text,/#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:10.000Z/)
  for(const path of text.split('\n').filter(l=>l&&!l.startsWith('#'))) assert.equal(await (await fetch(new URL(path,url))).text(),'video')
  assert.equal((await fetch(url.replace(/\/[a-f0-9]{48}\//,'/wrong/'))).status,403)
  assert.equal((await fetch(url.replace('index.m3u8','%2e%2e%2fsecret'))).status,404)
})

test('forty minutes of playlist rollover retains paused history then evicts only watched media', async t => {
  let first=0
  const {dvr}=await fixture(t,{fetch:async url=> new Response(String(url).endsWith('.ts')?'data':media(first))})
  const result=await dvr.start(master(),'source',epoch+12500)
  for(first=3;first<=240;first+=3){ const target=first+2; await until(()=>dvr.status().bytes>=target*4) }
  let text=await (await fetch(playlistUrl(result))).text()
  assert.equal(text.split('\n').filter(l=>l.endsWith('.ts')).length,242)
  assert.match(text,/#EXT-X-MEDIA-SEQUENCE:1\n/)
  assert.equal(await(await fetch(new URL('1.ts',playlistUrl(result)))).text(),'data')
  dvr.updatePosition(2300)
  await until(async()=> (await (await fetch(playlistUrl(result))).text()).includes('#EXT-X-MEDIA-SEQUENCE:219'))
  text=await (await fetch(playlistUrl(result))).text()
  assert.match(text,/#EXT-X-MEDIA-SEQUENCE:219/)
})

test('renews expired URLs without skipping sequence and retains data at a gap', async t=>{
  let expired=false
  const {dvr}=await fixture(t,{resolveMaster:async()=>master('-renewed'),fetch:async url=>{
    const u=String(url)
    if(u.endsWith('.ts')) return new Response('data')
    if(expired&&!u.includes('renewed')) return new Response('',{status:403})
    return new Response(media(expired?3:0))
  }})
  const result=await dvr.start(master(),'source',epoch+1000)
  expired=true
  await until(()=>dvr.status().bytes===24)
  assert.match(await (await fetch(playlistUrl(result))).text(),/5.ts/)
})

test('cap and missing sequence stop with playable endlist and an explicit error',async t=>{
  let first=0
  const {dvr}=await fixture(t,{maxBytes:15,fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(first))})
  const result=await dvr.start(master(),'source',epoch+1000)
  first=3
  await until(()=>!dvr.status().active)
  assert.match(dvr.status().error,/storage|limit|ceiling/i)
  assert.equal(dvr.status().bytes,12)
  assert.match(await (await fetch(playlistUrl(result))).text(),/#EXT-X-ENDLIST/)
  await dvr.stop()
  first=0
  const result2=await dvr.start(master(),'source',epoch+1000)
  first=8
  await until(()=>!dvr.status().active)
  assert.match(dvr.status().error,/missing|gap/i)
  assert.match(await (await fetch(playlistUrl(result2))).text(),/#EXT-X-ENDLIST/)
})

test('startup cleans only dedicated root; stop aborts and deletes before resolving',async t=>{
  const {dvr,root,parent}=await fixture(t,{fetch:async(url,init)=>{
    if(String(url).endsWith('.ts'))return new Response('data')
    return new Response(media(0))
  }})
  await writeFile(join(parent,'keep'),'safe')
  await mkdir(join(root,'crashed'),{recursive:true});await writeFile(join(root,'crashed','partial'),'x')
  await dvr.initialize()
  assert.deepEqual(await readdir(root),[])
  await dvr.start(master(),'source',epoch+1000)
  await dvr.stop()
  assert.deepEqual(await readdir(root),[])
  assert.equal(await readFile(join(parent,'keep'),'utf8'),'safe')
})

test('unsupported encryption is rejected explicitly and never published',async t=>{
  const {dvr}=await fixture(t,{fetch:async()=>new Response(media(0).replace('#EXTINF:10,','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:10,'))})
  await assert.rejects(dvr.start(master(),'source',epoch+1000),/unsupported|encrypted/i)
  assert.equal(dvr.status().active,false)
})


test('stop cancels a preparation download and waits for file handles before cleanup',async t=>{
  let downloading
  const started=new Promise(r=>{downloading=r})
  const {dvr,root}=await fixture(t,{fetch:async(url,init)=>{
    if(!String(url).endsWith('.ts'))return new Response(media(0))
    downloading()
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array([1,2,3]))
      init.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true})
    }}))
  }})
  const preparation=dvr.start(master(),'source',epoch+12500)
  const rejected=assert.rejects(preparation,/abort|cancel/i)
  await started
  await dvr.stop()
  await rejected
  assert.deepEqual(await readdir(root),[])
  assert.equal(dvr.status().active,false)
})

test('paused timestamp outside available window is rejected instead of clamped',async t=>{
  const {dvr}=await fixture(t,{fetch:async()=>new Response(media(3))})
  await assert.rejects(dvr.start(master(),'source',epoch+1000),/no longer available/i)
  assert.equal(dvr.status().active,false)
})

test('persistent playlist network failure ends retained recording after finite retries',async t=>{
  let failed=false
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(failed)throw new Error('network unavailable')
    return new Response(String(url).endsWith('.ts')?'data':media(0))
  }})
  const result=await dvr.start(master(),'source',epoch+1000)
  failed=true
  await until(()=>!dvr.status().active)
  assert.match(dvr.status().error,/network/)
  assert.match(await(await fetch(playlistUrl(result))).text(),/#EXT-X-ENDLIST/)
})

test('captures the paused segment before older history can expire',async t=>{
  const requests=[]
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('.ts')){requests.push(new URL(url).pathname);return new Response('data')}
    return new Response(media(0))
  }})
  await dvr.start(master(),'source',epoch+12500)
  assert.deepEqual(requests,['/1.ts','/2.ts'])
})

test('a downloading segment is absent from playlist until its file is closed and published',async t=>{
  let first=0, release
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/3.ts'))return new Response(new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode('saved'));c.close()}}}))
    return new Response(String(url).endsWith('.ts')?'data':media(first))
  }})
  const result=await dvr.start(master(),'source',epoch+1000)
  first=3
  await until(()=>!!release)
  assert.doesNotMatch(await(await fetch(playlistUrl(result))).text(),/\n3.ts\n/)
  release()
  await until(async()=> (await(await fetch(playlistUrl(result))).text()).includes('\n3.ts\n'))
  assert.equal(await(await fetch(new URL('3.ts',playlistUrl(result)))).text(),'saved')
})

test('expired segment URLs renew the same sequence without a gap',async t=>{
  let first=0
  const {dvr}=await fixture(t,{resolveMaster:async()=>master('-renewed'),fetch:async url=>{
    const u=String(url)
    if(new URL(u).pathname==='/3.ts')return new Response('',{status:403})
    if(u.endsWith('.ts'))return new Response('data')
    const text=media(first)
    return new Response(u.includes('renewed')?text.replaceAll('stream.test/','stream.test/renewed/'):text)
  }})
  const result=await dvr.start(master(),'source',epoch+1000)
  first=3
  await until(()=>dvr.status().bytes===24)
  const text=await(await fetch(playlistUrl(result))).text()
  assert.match(text,/\n3.ts\n/)
  assert.equal(await(await fetch(new URL('3.ts',playlistUrl(result)))).text(),'data')
  assert.equal(dvr.status().error,null)
})

test('disk failure stops recording and retains its published playlist',async t=>{
  let first=0
  const {dvr,root}=await fixture(t,{fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(first))})
  const result=await dvr.start(master(),'source',epoch+1000)
  const [directory]=await readdir(root)
  await mkdir(join(root,directory,'3.partial'))
  first=3
  await until(()=>!dvr.status().active)
  assert.ok(dvr.status().error)
  const text=await(await fetch(playlistUrl(result))).text()
  assert.match(text,/#EXT-X-ENDLIST/)
  assert.doesNotMatch(text,/\n3.ts\n/)
  assert.equal(await(await fetch(new URL('2.ts',playlistUrl(result)))).text(),'data')
})


test('pause offset stays within its covering segment across program date jumps',async t=>{
  const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-TARGETDURATION:10\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:00Z\n#EXTINF:10,\n0.ts\n#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T13:00:00Z\n#EXTINF:10,\n1.ts\n'
  const {dvr}=await fixture(t,{fetch:async url=>new Response(String(url).endsWith('.ts')?'data':text)})
  const result=await dvr.start(master(),'source',epoch+3602500)
  assert.equal(result.startAt,2.5)
})

test('backward seek updates eviction to the actual paused playhead',async t=>{
  const {dvr}=await fixture(t,{pollMs:100,fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(0,30))})
  const result=await dvr.start(master(),'source',epoch+1000)
  dvr.updatePosition(280)
  dvr.updatePosition(150)
  await until(()=>dvr.status().bytes<120)
  await new Promise(resolve=>setTimeout(resolve,250))
  assert.match(await(await fetch(playlistUrl(result))).text(),/#EXT-X-MEDIA-SEQUENCE:3\n/)
  assert.equal(await(await fetch(new URL('15.ts',playlistUrl(result)))).text(),'data')
})

test('broadcaster sequence regression stops explicitly instead of polling forever',async t=>{
  let reset=false
  const {dvr}=await fixture(t,{fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(reset?0:10))})
  const result=await dvr.start(master(),'source',epoch+101000)
  reset=true
  await until(()=>!dvr.status().active)
  assert.match(dvr.status().error,/sequence|restart|regress/i)
  assert.match(await(await fetch(playlistUrl(result))).text(),/#EXT-X-ENDLIST/)
})


test('recorded master retains selected quality metadata and rejects external audio dependencies',async t=>{
  const {dvr}=await fixture(t,{fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(0))})
  const source='#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="source",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2",VIDEO="source"\nhttps://stream.test/live.m3u8\n'
  const result=await dvr.start(source,'source',epoch+1000)
  assert.match(result.masterPlaylist,/NAME="1080p60 \(source\)"/)
  assert.match(result.masterPlaylist,/RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"/)
  await dvr.stop()
  const external=source.replace('#EXT-X-STREAM-INF:','#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio",URI="https://other.test/audio.m3u8"\n#EXT-X-STREAM-INF:AUDIO="audio",')
  await assert.rejects(dvr.start(external,'source',epoch+1000),/external|unsupported/i)
})

test('storage cap reclaims eligible watched segments before saving the next live batch',async t=>{
  let first=0
  const {dvr}=await fixture(t,{maxBytes:60,pollMs:50,fetch:async url=>new Response(String(url).endsWith('.ts')?'data':media(first,15))})
  const result=await dvr.start(master(),'source',epoch+1000)
  assert.equal(dvr.status().bytes,60)
  dvr.updatePosition(150)
  first=3
  await until(async()=> (await(await fetch(playlistUrl(result))).text()).includes('\n17.ts\n') || !dvr.status().active)
  assert.equal(dvr.status().active,true)
  assert.equal(dvr.status().error,null)
  assert.equal(dvr.status().bytes,60)
  const text=await(await fetch(playlistUrl(result))).text()
  assert.match(text,/#EXT-X-MEDIA-SEQUENCE:3\n/)
  assert.match(text,/\n17.ts\n/)
})

test('playhead progress during a download reclaims watched files before treating the cap as full',async t=>{
  let first=0
  const {dvr}=await fixture(t,{maxBytes:60,pollMs:50,fetch:async url=>{
    if(String(url).endsWith('/15.ts'))dvr.updatePosition(150)
    return new Response(String(url).endsWith('.ts')?'data':media(first,15))
  }})
  const result=await dvr.start(master(),'source',epoch+1000)
  first=3
  await until(async()=> (await(await fetch(playlistUrl(result))).text()).includes('\n17.ts\n') || !dvr.status().active)
  assert.equal(dvr.status().active,true)
  assert.equal(dvr.status().error,null)
  assert.equal(dvr.status().bytes,60)
  assert.match(await(await fetch(playlistUrl(result))).text(),/\n17.ts\n/)
})

test('first pause succeeds when older pre-pause segments have already expired',async t=>{
  const requested=[]
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(!String(url).endsWith('.ts'))return new Response(media(0,5).replace('#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-DISCONTINUITY-SEQUENCE:9'))
    const sequence=Number(new URL(url).pathname.slice(1,-3))
    requested.push(sequence)
    return new Response(sequence<3?'':'saved',{status:sequence<3?404:200})
  }})
  const result=await dvr.start(master(),'source',epoch+32500)
  assert.equal(result.startAt,2.5)
  assert.deepEqual(requested,[3,4])
  const text=await(await fetch(playlistUrl(result))).text()
  assert.match(text,/#EXT-X-MEDIA-SEQUENCE:3\n/)
  assert.match(text,/#EXT-X-DISCONTINUITY-SEQUENCE:10\n/)
  assert.match(text,/#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:30.000Z/)
  assert.equal(await(await fetch(new URL('3.ts',playlistUrl(result)))).text(),'saved')
})


test('initial failure after saving the paused frame returns playable stopped recording',async t=>{
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/2.ts'))return new Response('',{status:404})
    return new Response(String(url).endsWith('.ts')?'saved':media(0))
  }})
  const result=await dvr.start(master(),'source',epoch+12500)
  assert.equal(result.startAt,2.5)
  assert.equal(dvr.status().active,false)
  assert.ok(dvr.status().error)
  const text=await(await fetch(playlistUrl(result))).text()
  assert.match(text,/#EXT-X-ENDLIST/)
  assert.match(text,/\n1.ts\n/)
  assert.doesNotMatch(text,/\n2.ts\n/)
  assert.equal(await(await fetch(new URL('1.ts',playlistUrl(result)))).text(),'saved')
})

test('initial cap after saving the paused frame returns playable stopped recording',async t=>{
  const {dvr}=await fixture(t,{maxBytes:5,fetch:async url=>new Response(String(url).endsWith('.ts')?'saved':media(0))})
  const result=await dvr.start(master(),'source',epoch+12500)
  assert.equal(result.startAt,2.5)
  assert.equal(dvr.status().active,false)
  assert.match(dvr.status().error,/storage|limit/i)
  assert.match(await(await fetch(playlistUrl(result))).text(),/#EXT-X-ENDLIST/)
  assert.equal(await(await fetch(new URL('1.ts',playlistUrl(result)))).text(),'saved')
})

test('first-segment failure still rejects because no paused frame was saved',async t=>{
  const {dvr}=await fixture(t,{fetch:async url=>new Response(String(url).endsWith('.ts')?'':media(0),{status:String(url).endsWith('.ts')?404:200})})
  await assert.rejects(dvr.start(master(),'source',epoch+12500),/expired|missing/i)
  assert.equal(dvr.status().bytes,0)
  assert.equal(dvr.status().active,false)
})

test('cancellation after first saved segment still rejects preparation and deletes the recording',async t=>{
  let downloading
  const secondStarted=new Promise(resolve=>{downloading=resolve})
  const {dvr,root}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/2.ts'))return new Response(new ReadableStream({start(){downloading()}}))
    return new Response(String(url).endsWith('.ts')?'saved':media(0))
  }})
  const start=dvr.start(master(),'source',epoch+12500)
  const rejected=assert.rejects(start,/abort|cancel/i)
  await secondStarted
  assert.equal(dvr.status().bytes,5)
  await dvr.stop()
  await rejected
  assert.deepEqual(await readdir(root),[])
})

test('transient segment HTTP failure retries the same initial segment without losing continuity',async t=>{
  let attempts=0
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/1.ts')&&++attempts===1)return new Response('',{status:503})
    return new Response(String(url).endsWith('.ts')?'saved':media(0))
  }})
  const result=await dvr.start(master(),'source',epoch+12500)
  assert.equal(attempts,2)
  assert.equal(dvr.status().active,true)
  assert.equal(dvr.status().error,null)
  assert.match(await(await fetch(playlistUrl(result))).text(),/\n1.ts\n/)
  assert.match(await(await fetch(playlistUrl(result))).text(),/\n2.ts\n/)
})

test('persistent transient HTTP failures stop after bounded same-segment retries and preserve saved data',async t=>{
  let attempts=0
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/2.ts')){attempts++;return new Response('',{status:503})}
    return new Response(String(url).endsWith('.ts')?'saved':media(0))
  }})
  const result=await dvr.start(master(),'source',epoch+12500)
  assert.equal(attempts,3)
  assert.equal(dvr.status().active,false)
  assert.match(dvr.status().error,/503/)
  assert.match(await(await fetch(playlistUrl(result))).text(),/#EXT-X-ENDLIST/)
  assert.equal(await(await fetch(new URL('1.ts',playlistUrl(result)))).text(),'saved')
})

test('transient fetch rejection during initial capture retries the paused segment',async t=>{
  let attempts=0
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('/1.ts')&&++attempts===1)throw new TypeError('fetch failed')
    return new Response(String(url).endsWith('.ts')?'saved':media(0))
  }})
  const result=await dvr.start(master(),'source',epoch+12500)
  assert.equal(attempts,2)
  assert.equal(dvr.status().error,null)
  assert.equal(await(await fetch(new URL('1.ts',playlistUrl(result)))).text(),'saved')
})

test('persistent transient first-segment failure rejects after bounded attempts without publishing data',async t=>{
  let attempts=0
  const {dvr}=await fixture(t,{fetch:async url=>{
    if(String(url).endsWith('.ts')){attempts++;return new Response('',{status:429})}
    return new Response(media(0))
  }})
  await assert.rejects(dvr.start(master(),'source',epoch+12500),/3 attempts.*429/)
  assert.equal(attempts,3)
  assert.equal(dvr.status().active,false)
  assert.equal(dvr.status().bytes,0)
})

test('stop cancels a segment retry delay and closes the failed HTTP body',async t=>{
  let attempts=0, bodyClosed
  const closed=new Promise(resolve=>{bodyClosed=resolve})
  const {dvr,root}=await fixture(t,{pollMs:5000,fetch:async url=>{
    if(String(url).endsWith('.ts')){
      attempts++
      return new Response(new ReadableStream({cancel(){bodyClosed()}}),{status:502})
    }
    return new Response(media(0))
  }})
  const start=dvr.start(master(),'source',epoch+12500)
  const rejected=assert.rejects(start,/abort|cancel/i)
  await closed
  await dvr.stop()
  await rejected
  assert.equal(attempts,1)
  assert.deepEqual(await readdir(root),[])
})
