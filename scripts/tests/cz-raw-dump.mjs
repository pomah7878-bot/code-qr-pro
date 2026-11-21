import { writeFileSync } from 'node:fs';

const B = 'https://mobile.api.crpt.ru/mobile/check';
const GS = '\u001d';
const code = `0104638230913287215ZsWrd${GS}91EE12${GS}92f2+hPGe2ZRc2FmzC1oFm+6Nwt1PxgpCRp9khyOKEEG4w=`;

async function post(params) {
  const res = await fetch(B, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://code-qr.stockcity.ru' },
    body: new URLSearchParams(params).toString()
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const status = await post({ code });
console.log('STATUS HTTP', status.status);
const d = status.data || {};
console.log('top:', JSON.stringify({ codeFounded: d.codeFounded, checkResult: d.checkResult, status: d.status, statusV2: d.statusV2, category: d.category, productName: d.productName, warning: d.warning, catalogCount: (d.catalogData || []).length }));
console.log('chemistryData:', JSON.stringify(d.chemistryData || {}, null, 1));
console.log('codeResolveData:', JSON.stringify(d.codeResolveData || {}, null, 1));
console.log('catalogData0:', JSON.stringify((d.catalogData || [])[0] || {}, null, 1));

const catalog = await post({ code: '04638230913287', codeType: 'ean13' });
console.log('\nCATALOG HTTP', catalog.status);
const c0 = ((catalog.data || {}).catalogData || [])[0] || {};
console.log('catalog fields:', JSON.stringify({ good_name: c0.good_name, brand_name: c0.brand_name, producer_name: c0.producer_name, categories: c0.categories, good_images: c0.good_images }, null, 1));
console.log('attrs:', JSON.stringify((c0.good_attrs || []).map((a) => ({ name: a.attr_name, value: a.attr_value })), null, 1));

writeFileSync('/tmp/cz-status.json', JSON.stringify(d, null, 1));
writeFileSync('/tmp/cz-catalog.json', JSON.stringify(catalog.data, null, 1));
