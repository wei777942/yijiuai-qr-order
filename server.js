const http=require('http'),fs=require('fs'),path=require('path'),QR=require('qrcode'),crypto=require('crypto');
const PORT=process.env.PORT||8787, DB=path.join(__dirname,'data.json'), PUB=path.join(__dirname,'public');
let db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB)):{shop:'依舊愛咖啡',pin:'1234',tables:15,stations:['出餐口 1','出餐口 2'],
 categories:[{id:'c1',name:'咖啡',station:0},{id:'c2',name:'茶飲',station:1}],
 items:[{id:'i1',cat:'c1',name:'美式咖啡',price:80,img:'',soldOut:false,station:null,opts:'size,sugar,ice',addons:[{name:'加濃縮',price:20}]},
        {id:'i2',cat:'c1',name:'拿鐵',price:110,img:'',soldOut:false,station:null,opts:'size,sugar,ice',addons:[{name:'燕麥奶',price:15}]},
        {id:'i3',cat:'c2',name:'紅茶',price:50,img:'',soldOut:false,station:null,opts:'size,sugar,ice',addons:[{name:'珍珠',price:10}]}],
 orders:[],seq:0};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const clients=new Set();
const push=(ev,d)=>{for(const r of clients)r.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`)};
const stationOf=it=>{if(it.station!=null&&it.station!=='')return +it.station;const c=db.categories.find(c=>c.id===it.cat);return c?+c.station:0};
const body=req=>new Promise(r=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
const json=(res,d,c=200)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(d))};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const id=()=>crypto.randomBytes(4).toString('hex');
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method;
 try{
 if(p==='/api/menu')return json(res,{shop:db.shop,categories:db.categories,items:db.items,stations:db.stations,tables:db.tables});
 if(p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(':ok\n\n');clients.add(res);const k=setInterval(()=>res.write(':k\n\n'),20000);req.on('close',()=>{clearInterval(k);clients.delete(res)});return}
 if(p==='/api/orders'&&m==='GET')return json(res,db.orders.filter(o=>!o.archived));
 if(p==='/api/orders'&&m==='POST'){const b=await body(req);const t=+b.table;if(!(t>=1&&t<=db.tables)||!Array.isArray(b.lines)||!b.lines.length)return json(res,{error:'bad'},400);
  const lines=[];for(const l of b.lines){const it=db.items.find(i=>i.id===l.id);if(!it||it.soldOut)return json(res,{error:(it?it.name:'品項')+' 已售完或不存在'},400);
   const adds=(l.addons||[]).map(n=>it.addons.find(a=>a.name===n)).filter(Boolean);const big=l.size==='大杯'?10:0;const qty=Math.max(1,Math.min(20,+l.qty||1));
   lines.push({iid:it.id,name:it.name,qty,size:l.size||'',sugar:l.sugar||'',ice:l.ice||'',addons:adds.map(a=>a.name),note:String(l.note||'').slice(0,100),unit:it.price+big+adds.reduce((s,a)=>s+a.price,0),station:stationOf(it),done:false})}
  const o={id:id(),no:++db.seq,table:t,lines,total:lines.reduce((s,l)=>s+l.unit*l.qty,0),note:String(b.note||'').slice(0,200),status:'new',paid:false,ts:Date.now()};
  db.orders.push(o);save();push('order',o);return json(res,o)}
 let mm;
 if((mm=p.match(/^\/api\/orders\/(\w+)$/))&&m==='GET'){const o=db.orders.find(o=>o.id===mm[1]);return o?json(res,o):json(res,{},404)}
 if((mm=p.match(/^\/api\/orders\/(\w+)$/))&&m==='PATCH'){const o=db.orders.find(o=>o.id===mm[1]);if(!o)return json(res,{},404);const b=await body(req);
  if(b.station!=null){o.lines.forEach(l=>{if(l.station===+b.station){if(b.lineStatus==='making')l.making=true;if(b.lineStatus==='done')l.done=true}})}
  if(b.removeLine!=null){const l=o.lines[+b.removeLine];if(l){o.lines.splice(+b.removeLine,1);if(b.soldOut){const it=db.items.find(i=>i.id===l.iid||i.name===l.name);if(it){it.soldOut=true;push('menu',{})}}}o.total=o.lines.reduce((s,l)=>s+l.unit*l.qty,0);if(!o.lines.length)o.archived=true}
  if(b.paid!=null)o.paid=!!b.paid; if(b.archived)o.archived=true;
  o.status=!o.lines.length?'done':o.lines.every(l=>l.done)?'done':o.lines.some(l=>l.making||l.done)?'making':'new';
  save();push('update',o);return json(res,o)}
 if(p.startsWith('/api/admin/')&&req.headers['x-pin']!==db.pin)return json(res,{error:'密碼錯誤'},401);
 if(p==='/api/admin/check')return json(res,{ok:1});
 if(p==='/api/admin/save'&&m==='POST'){const b=await body(req);for(const k of ['shop','pin','categories','items','stations','tables'])if(b[k]!=null)db[k]=b[k];save();push('menu',{});return json(res,{ok:1})}
 if(p==='/api/admin/upload'&&m==='POST'){const b=await body(req);const mt=/^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(b.data||'');if(!mt)return json(res,{error:'bad'},400);const f=id()+'.'+mt[1].replace('jpeg','jpg');fs.writeFileSync(path.join(PUB,'uploads',f),Buffer.from(mt[2],'base64'));return json(res,{url:'/uploads/'+f})}
 if(p==='/api/qr'){const png=await QR.toBuffer(u.searchParams.get('u')||'',{width:400,margin:1});res.writeHead(200,{'Content-Type':'image/png'});return res.end(png)}
 const routes={'/':'/menu.html','/bar':'/bar.html','/cashier':'/cashier.html','/admin':'/admin.html'};
 let f=routes[p]||(p.match(/^\/t\/\d+$/)?'/menu.html':p);f=path.normalize(path.join(PUB,f));
 if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('not found')}
 res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
 }catch(e){console.error(e);json(res,{error:'server'},500)}
}).listen(PORT,()=>console.log('on',PORT));
