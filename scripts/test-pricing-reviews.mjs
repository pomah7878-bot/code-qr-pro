import Database from '../server/node_modules/better-sqlite3/lib/index.js';
const BASE='http://127.0.0.1:3102'; const DBFILE='server/data/test-pr.db';
let cookie='';
async function req(m,p,b){const res=await fetch(BASE+p,{method:m,headers:{...(b?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:b?JSON.stringify(b):undefined});const sc=res.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const ct=res.headers.get('content-type')||'';return{status:res.status,data:ct.includes('json')?await res.json():Buffer.from(await res.arrayBuffer())};}
function assert(c,m,d){if(!c){console.error('FAIL:',m,d?JSON.stringify(d).slice(0,300):'');process.exit(1);}console.log('ok:',m);}
let r=await req('POST','/api/auth/register',{email:'a@test.local',password:'testpass123',name:'Admin'});
assert(r.data.user.role==='admin','admin');const admin=cookie;
r=await req('POST','/api/auth/register',{email:'u@test.local',password:'testpass123',name:'User'});const user=cookie;
cookie=admin;r=await req('GET','/api/admin/pricing');assert(r.data.offers.length===1&&r.data.offers[0].days===30&&r.data.offers[0].price===1990,'дефолт 30/1990',r.data);
r=await req('PUT','/api/admin/pricing',{offers:[{days:30,price:1990},{days:180,price:9990},{days:365,price:17990}],testPrice:1});
assert(r.status===200&&r.data.offers.length===3,'добавлены 3 периода',r.data);
r=await req('GET','/api/plans');const prem=r.data.plans.find(p=>p.id==='premium');assert(prem.offers.length===3,'витрина: 3 offers',prem.offers);
r=await req('PUT','/api/admin/pricing',{offers:[{days:30,price:100},{days:30,price:200}]});assert(r.status===400,'дубли периодов отклонены');
r=await req('PUT','/api/admin/pricing',{offers:[{days:30,price:0}]});assert(r.status===400,'цена 0 отклонена');
r=await req('POST','/api/billing/checkout',{plan:'premium',days:180});assert(r.status===503,'checkout 180 доходит до провайдера',r);
r=await req('POST','/api/billing/checkout',{plan:'premium',days:999});assert(r.status===400,'несуществующий период 400',r);
cookie=user;r=await req('POST','/api/reviews',{rating:5,text:'Отличный сервис, всё работает быстро!',authorName:'Иван'});assert(r.status===200&&r.data.status==='pending','отзыв создан pending',r);
r=await req('GET','/api/reviews');assert(r.data.count===0,'pending не виден публично');
cookie=admin;r=await req('GET','/api/admin/reviews');const rid=r.data.reviews[0].id;
r=await req('POST','/api/admin/reviews/'+rid+'/moderate',{status:'approved'});assert(r.status===200,'одобрен');
r=await req('GET','/api/reviews');assert(r.data.count===1&&r.data.avgRating===5,'виден публично, рейтинг 5',r.data);
cookie=user;r=await req('POST','/api/reviews',{rating:4,text:'Обновлённый отзыв после использования'});assert(r.status===200,'повторный отзыв обновлён');
r=await req('GET','/api/reviews/mine');assert(r.data.review.rating===4&&r.data.review.status==='pending','свой отзыв: 4 pending',r.data);
r=await req('POST','/api/reviews',{rating:5,text:'коротко'});assert(r.status===400,'короткий отзыв 400');
console.log('\nALL PRICING+REVIEWS TESTS PASSED');