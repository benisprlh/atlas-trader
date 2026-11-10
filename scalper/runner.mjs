import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {config,initial,step} from './engine.mjs';
const c=config(process.env.SCALPER_CONFIG?JSON.parse(readFileSync(process.env.SCALPER_CONFIG,'utf8')):{});
const dir=resolve(process.env.SCALPER_DATA||'scalper-data');mkdirSync(dir,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(dir,'paper.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, config TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, payload TEXT NOT NULL);');
const saved=db.prepare('SELECT config FROM metadata WHERE id=1').get();
if(saved&&saved.config!==JSON.stringify(c))throw Error('Config changed: use a NEW data directory. Existing history is frozen.');
db.prepare('INSERT OR IGNORE INTO metadata VALUES (1,?)').run(JSON.stringify(c));
let latest=null,stopping=false,timer,failures=0;
const read=()=>{const r=db.prepare('SELECT payload FROM cycles ORDER BY id DESC LIMIT 1').get();return r?JSON.parse(r.payload):{state:initial(c),events:[],reason:'STARTING'};};
latest=read();
async function market(path){const started=Date.now();const r=await fetch('https://api.kraken.com/0/public/'+path,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Accept:'application/json'}});if(!r.ok)throw Error('Kraken HTTP '+r.status);const p=await r.json();if(p.error?.length||!p.result)throw Error('Kraken data error');if(Date.now()-started>10000)throw Error('Slow feed');return p.result;}
async function cycle(){
 try{
  // Exit checks remain available even when OHLC fetch fails.
  const tick=await market('Ticker?pair=ETHUSD'),quote=Object.values(tick)[0],quoteAt=Date.now();
  let bars=[],candleError=null;
  try{const data=await market('OHLC?pair=ETHUSD&interval=1');bars=Object.entries(data).find(([k,v])=>k!=='last'&&Array.isArray(v))[1].slice(0,-1).map(r=>({time:Number(r[0])*1000,open:+r[1],high:+r[2],low:+r[3],close:+r[4]})).filter(b=>b.time+60000<=Date.now());}catch{candleError='OHLC unavailable; entries blocked';}
  db.exec('BEGIN IMMEDIATE');
  try{const before=read();const out=step(before.state,{now:Date.now(),bars,bid:+quote.b[0],ask:+quote.a[0],quoteAt},c);latest={...out,time:Date.now(),mode:'paper',symbol:'ETH/USD',engine:'deterministic-scalper-v1',source:'Kraken REST live',candleError,config:c,apiCost:null};db.prepare('INSERT INTO cycles(time,payload) VALUES (?,?)').run(latest.time,JSON.stringify(latest));db.exec('COMMIT');failures=0;}catch(e){db.exec('ROLLBACK');throw e;}
 }catch(e){failures++;latest={...read(),events:[],time:Date.now(),reason:'FEED_OR_STORAGE_ERROR',error:e.message};console.error(JSON.stringify({time:latest.time,error:e.message}));try{db.prepare('INSERT INTO cycles(time,payload) VALUES (?,?)').run(latest.time,JSON.stringify(latest));}catch{console.error('Audit storage unavailable; stopping runner');stopping=true;server?.close();process.exitCode=1;}}
 if(!stopping&&!process.argv.includes('--once'))timer=setTimeout(cycle,Math.min(120000,15000*2**Math.min(failures,3)));
}
const html=readFileSync(new URL('./dashboard.html',import.meta.url));
const server=process.argv.includes('--once')?null:createServer((req,res)=>{
 if(!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||'')){res.writeHead(403);return res.end();}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(latest));}
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 res.writeHead(404);res.end();
}).listen(Number(process.env.PORT||8788),'127.0.0.1'); // Do not expose without authenticated TLS reverse proxy.
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;clearTimeout(timer);server?.close();});
await cycle();
if(process.argv.includes('--once')&&latest.error)process.exitCode=1;
if(process.argv.includes('--once'))console.log(JSON.stringify({reason:latest.reason,error:latest.error||null,time:latest.time,events:latest.events.length}));
