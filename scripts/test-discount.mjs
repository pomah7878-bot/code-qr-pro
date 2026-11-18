const BASE='http://127.0.0.1:3103';let cookie='';
async function req(m,p,b){const res=await fetch(BASE+p,{method:m,headers:{...(b?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:b?JSON.stringify(b):undefined});const sc=res.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];return{status:res.status,data:await res.json().catch(()=>({}))};}
function assert(c,m,d){if(!c){console.error('FAIL:',m,d?JSON.stringify(d).slice(0,300):'');process.exit(1);}console.log('ok:',m);}
let r=await req('POST','/api/auth/register',{email:'a@t.local',password:'testpass123',name:'A'});assert(r.data.user.role==='admin','admin');
r=await req('PUT','/api/admin/pricing',{offers:[{days:30,price:1990,discount:0},{days:365,price:23880,discount:20}]});
assert(r.status===200,'сохранено со скидкой',r);
const y=r.data.offers.find(o=>o.days===365);assert(y.finalPrice===19104&&y.discount===20,'365: 23880-20%=19104',y);
assert(y.perMonth===Math.round(19104/365*30*100)/100,'perMonth пересчитан',y.perMonth);
r=await req('GET','/api/plans');const prem=r.data.plans.find(p=>p.id==='premium');
assert(prem.offers.length===2,'витрина: 2 периода',prem.offers);
assert(prem.offers.find(o=>o.days===365).finalPrice===19104,'витрина показывает цену со скидкой');
r=await req('PUT','/api/admin/pricing',{offers:[{days:30,price:1990,discount:95}]});assert(r.status===400,'скидка >90% отклонена');
r=await req('POST','/api/billing/checkout',{plan:'premium',days:365});assert(r.status===503,'checkout 365 доходит до провайдера (сумма со скидкой)',r);
console.log('\nDISCOUNT TESTS PASSED');