// E2E раздела «Маркетплейсы». Запуск: отдельный сервер с чистой БД:
//   set PORT=3101 DB_PATH=server/data/test-mp.db JOBS_DIR=server/data/test-mp-jobs MP_DOCS_DIR=server/data/test-mp-docs && node server/src/index.js
//   node scripts/test-marketplaces.mjs
import Database from '../server/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.MP_BASE || 'http://127.0.0.1:3101';
const DB_PATH = process.env.MP_DB || 'server/data/test-mp.db';
const RUN = Date.now();
let cookie = '';
async function req(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Origin: BASE, ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(headers || {}) },
    body: body instanceof Buffer ? body : (body ? JSON.stringify(body) : undefined)
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, ct };
}
function assert(cond, msg, dump) { if (!cond) { console.error('FAIL:', msg, dump ? JSON.stringify(dump).slice(0, 500) : ''); process.exit(1); } console.log('ok:', msg); }
const noAuth = () => { const c = cookie; cookie = ''; return c; };

// Анонимный доступ закрыт
let r = await req('GET', '/api/marketplaces/overview');
assert(r.status === 401, 'аноним → 401');

const email = 'mp-' + Date.now() + '@test.local';
r = await req('POST', '/api/auth/register', { email, password: 'testpass123', name: 'MP Test', consent: true });
assert(r.status === 200, 'register');

r = await req('GET', '/api/marketplaces/overview');
assert(r.status === 200 && r.data.markets.length === 3, 'overview: 3 площадки');
const wb = r.data.profiles.find((p) => p.id === 'wb-product-58x40');
assert(wb && !wb.requiresCheck && wb.sourceUrl && wb.verifiedAt, 'профиль WB проверен, с источником');
const draft = r.data.profiles.find((p) => p.id === 'ozon-fbo-cargo-120x75');
assert(draft && draft.requiresCheck, 'черновик Ozon FBO помечен «Требует проверки»');

// Товары
r = await req('POST', '/api/marketplaces/products', { name: '' });
assert(r.status === 400, 'товар без названия → 400', r);
r = await req('POST', '/api/marketplaces/products', {
  marketplace: 'wildberries', name: 'Сыворотка LF', manufacturer: 'ООО «НПЦ МИГ»',
  produced_at: '06.08.2026', barcode: '4638230913287', sku: 'ART-1', brand: 'LIGHT FIT'
});
assert(r.status === 201 && r.data.product.id, 'товар создан');
const productId = r.data.product.id;
r = await req('GET', '/api/marketplaces/products?query=Сыворотка');
assert(r.data.products.length === 1, 'поиск товара');

// Предпросмотр
r = await req('POST', '/api/marketplaces/labels/preview', { profileId: 'wb-product-58x40', productId });
assert(r.status === 200 && r.data.canPrint, 'предпросмотр: можно печатать', r);
assert(r.data.elements.some((e) => e.pngBase64), 'предпросмотр: штрихкод PNG');
r = await req('POST', '/api/marketplaces/labels/preview', { profileId: 'wb-product-58x40', fields: { name: 'Т', barcode: '4638230913280' } });
assert(r.status === 200 && !r.data.canPrint && r.data.problems.some((p) => /контрольная цифра/.test(p)), 'неверная контрольная цифра EAN-13 блокирует');

// PDF точного размера
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'wb-product-58x40', productId, copies: 2, mode: 'label', idemKey: 'mp-test-1-' + RUN });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'PDF сформирован');
const mb = r.data.toString('latin1').match(/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
assert(mb && Math.abs(Number(mb[1]) - 164.41) < 0.5 && Math.abs(Number(mb[2]) - 113.39) < 0.5, 'PDF: страница 58×40 мм (164.41×113.39 pt)', mb);
// Идемпотентность: повтор с тем же idemKey не списывает повторно
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'wb-product-58x40', productId, copies: 2, mode: 'label', idemKey: 'mp-test-1-' + RUN });
assert(r.status === 200, 'повторный PDF с тем же idemKey');
const db = new Database(DB_PATH);
const ev = db.prepare('SELECT COUNT(*) n FROM usage_events WHERE idem_key=?').get('mp-test-1-' + RUN + ':mp_pdf');
assert(ev.n === 1, 'идемпотентность: одно списание на idemKey');
db.close();
// А4
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'wb-product-58x40', productId, copies: 3, mode: 'a4', idemKey: 'mp-test-a4' });
const mbA4 = r.data.toString('latin1').match(/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
assert(r.status === 200 && mbA4 && Math.abs(Number(mbA4[1]) - 595.28) < 0.5, 'PDF: лист А4');

// Печать HTML
r = await req('POST', '/api/marketplaces/labels/print', { profileId: 'wb-product-58x40', productId, copies: 1, idemKey: 'mp-test-print' });
assert(r.status === 200 && r.ct.includes('text/html') && r.data.toString().includes('58mm'), 'HTML-печать: @page 58mm');

// Черновик и транспортный профиль не генерируются
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'ozon-fbo-cargo-120x75', productId });
assert(r.status === 400, 'черновик не печатается');
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'wb-fbs-sticker-40x58', productId });
assert(r.status === 400, 'транспортный профиль — только оригинал');

// Загрузка оригиналов
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
r = await req('POST', '/api/marketplaces/documents/upload?marketplace=ozon&kind=shipping&profileId=ozon-fbs-120x75&filename=label.pdf', pdfBytes, { 'Content-Type': 'application/pdf' });
assert(r.status === 201 && r.data.sha256, 'PDF загружен');
const pdfDocId = r.data.id;
r = await req('POST', '/api/marketplaces/documents/upload?marketplace=ozon&kind=shipping&filename=fake.pdf', Buffer.from('not a pdf'), { 'Content-Type': 'application/pdf' });
assert(r.status === 400, 'поддельный PDF отклонён');
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
r = await req('POST', '/api/marketplaces/documents/upload?marketplace=ozon&kind=shipping&profileId=ozon-fbs-58x40&filename=label.png', pngBytes, { 'Content-Type': 'image/png' });
assert(r.status === 201, 'PNG загружен');
const pngDocId = r.data.id;
r = await req('GET', '/api/marketplaces/documents');
assert(r.data.documents.length === 2, 'список документов');
r = await req('GET', '/api/marketplaces/documents/' + pdfDocId);
assert(r.status === 200 && r.data.equals(pdfBytes), 'оригинал PDF отдаётся байт-в-байт');
r = await req('POST', '/api/marketplaces/documents/' + pdfDocId + '/print', { idemKey: 'mp-doc-pdf' });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'печать оригинала PDF');
r = await req('POST', '/api/marketplaces/documents/' + pngDocId + '/print', { profileId: 'ozon-fbs-58x40', idemKey: 'mp-doc-png' });
assert(r.status === 200 && r.ct.includes('text/html'), 'печать PNG по профилю размера');
r = await req('DELETE', '/api/marketplaces/documents/' + pngDocId);
assert(r.status === 200, 'документ удалён');
r = await req('GET', '/api/marketplaces/documents/' + pngDocId);
assert(r.status === 404, 'удалённый документ → 404');

// Чужой документ недоступен
const cookie1 = noAuth();
const email2 = 'mp2-' + Date.now() + '@test.local';
r = await req('POST', '/api/auth/register', { email: email2, password: 'testpass123', name: 'MP Test 2', consent: true });
assert(r.status === 200, 'register 2');
r = await req('GET', '/api/marketplaces/documents/' + pdfDocId);
assert(r.status === 404, 'чужой документ скрыт');

// Лимиты FREE: суточные операции
r = await req('POST', '/api/marketplaces/products', { name: 'Лимит-товар', barcode: '4638230913287' });
const pid2 = r.data.product.id;
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'ozon-product-58x40', productId: pid2, copies: 20, idemKey: 'mp-limit-20' });
assert(r.status === 200, 'FREE: 20 этикеток в суточный лимит');
r = await req('POST', '/api/marketplaces/labels/pdf', { profileId: 'ozon-product-58x40', productId: pid2, copies: 1, idemKey: 'mp-limit-1' });
assert(r.status === 402, 'FREE: сверх суточного лимита → 402');
cookie = cookie1;


// --- Короба (грузоместа) ---
r = await req('POST', '/api/marketplaces/boxes', { marketplace: 'ozon', scheme: 'fbs', name: 'Тест-короб' });
assert(r.status === 201 && r.data.box.id, 'короб создан');
const boxId = r.data.box.id;
r = await req('GET', '/api/marketplaces/boxes');
assert(r.data.boxes.length === 1, 'список коробов');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items', { productId, quantity: 2 });
assert(r.status === 201, 'позиция из сохранённого товара');
const itemId1 = r.data.item.id;
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items', { name: 'Ручной товар', barcode: '4638230913287', quantity: 2, profileId: 'ozon-product-30x20' });
assert(r.status === 201, 'позиция вручную с профилем 30×20');
const itemId2 = r.data.item.id;
r = await req('GET', '/api/marketplaces/boxes/' + boxId);
assert(r.data.items.length === 2 && r.data.guide && r.data.guide.steps.length, 'состав и инструкция площадки');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items/' + itemId1, { quantity: 3 });
assert(r.status === 200 && r.data.item.quantity === 3, 'количество обновлено');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/labels/pdf', { idemKey: 'mp-box-test' });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'PDF этикеток короба');
const boxesMb = (r.data.toString('latin1').match(/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g) || []).map((s) => { const m = s.match(/([\d.]+) ([\d.]+)\]/); return [Number(m[1]), Number(m[2])]; });
assert(boxesMb.length === 5, 'PDF: 5 страниц (3+2)', boxesMb.length);
assert(boxesMb.some(([w, h]) => Math.abs(w - 85.04) < 0.5 && Math.abs(h - 56.69) < 0.5) && boxesMb.some(([w, h]) => Math.abs(w - 164.41) < 0.5 && Math.abs(h - 113.39) < 0.5), 'PDF: разные размеры этикеток в одном файле (30×20 и 58×40)', boxesMb);
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/packing-list', { idemKey: 'mp-box-list-test' });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'упаковочный лист PDF');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/link-document', { documentId: pdfDocId });
assert(r.status === 200 && r.data.documentId === pdfDocId, 'оригинал привязан к коробу');
r = await req('GET', '/api/marketplaces/boxes/' + boxId);
assert(r.data.document && r.data.document.id === pdfDocId, 'привязанный документ в деталях');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/link-document', { documentId: null });
assert(r.status === 200 && r.data.documentId === null, 'оригинал отвязан');
r = await req('POST', '/api/marketplaces/boxes/' + boxId, { status: 'ready' });
assert(r.status === 200 && r.data.box.status === 'ready', 'статус короба обновлён');
r = await req('POST', '/api/marketplaces/boxes', { marketplace: 'ozon', scheme: 'fbs', name: 'Пустой' });
const emptyBoxId = r.data.box.id;
r = await req('POST', '/api/marketplaces/boxes/' + emptyBoxId + '/labels/pdf', {});
assert(r.status === 400, 'пустой короб → 400');
r = await req('DELETE', '/api/marketplaces/boxes/' + emptyBoxId);
assert(r.status === 200, 'пустой короб удалён');


// --- Паспорт короба ---
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items/' + itemId1, { codes: 'CODE-A\nCODE-B\nCODE-C' });
assert(r.status === 200 && r.data.item.codesCount === 3, 'коды единиц записаны (3 из 3)');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items/' + itemId1, { codes: 'CODE-A\nCODE-B' });
assert(r.status === 400, 'кодов меньше количества → 400');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items/' + itemId1, { codes: 'CODE-A\nCODE-A\nCODE-C' });
assert(r.status === 400, 'дубли кодов → 400');
r = await req('GET', '/api/marketplaces/boxes/' + boxId);
assert(r.data.items[0].expiry && r.data.items[0].expiry.status, 'срок годности в паспорте');
assert(Array.isArray(r.data.warnings) && Array.isArray(r.data.events) && r.data.events.length > 0, 'предупреждения и история событий');
assert(r.data.box.labelsStale === true, 'флаг перепечатки после изменения состава');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/picking-list', { idemKey: 'mp-pick-test' });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'пик-лист на сборку PDF');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/passport-label', { idemKey: 'mp-passport-test' });
assert(r.status === 200 && r.data.slice(0, 5).toString() === '%PDF-', 'паспорт-наклейка PDF');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/check-codes', {});
assert(r.status === 200 && (r.data.results || []).length === 3, 'онлайн-проверка кодов короба');
r = await req('GET', '/api/marketplaces/box-search?q=' + encodeURIComponent('Ручной'));
assert(r.status === 200 && r.data.boxes.some((b) => b.id === boxId), 'поиск товара по коробам');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/labels/pdf', { idemKey: 'mp-box-test-2' });
assert(r.status === 200, 'повторная печать этикеток');
r = await req('GET', '/api/marketplaces/boxes/' + boxId);
assert(r.data.box.labelsStale === false, 'флаг перепечатки снят после печати');
r = await req('POST', '/api/marketplaces/boxes/' + boxId, { status: 'shipped' });
assert(r.status === 200, 'короб отгружен');
r = await req('POST', '/api/marketplaces/boxes/' + boxId + '/items', { name: 'Нельзя', quantity: 1 });
assert(r.status === 409, 'отгруженный короб: состав заблокирован');
r = await req('POST', '/api/marketplaces/boxes/' + boxId, { name: 'Новое имя' });
assert(r.status === 409, 'отгруженный короб: имя заблокировано');
r = await req('POST', '/api/marketplaces/boxes/' + boxId, { status: 'packing' });
assert(r.status === 200, 'возврат статуса собираётся');
r = await req('GET', '/api/marketplaces/boxes/' + boxId);
assert(r.data.events.some((e) => e.action === 'status'), 'смена статуса в истории');

// Архив и удаление товара
r = await req('POST', '/api/marketplaces/products/' + productId + '/archive');
assert(r.status === 200, 'товар архивирован');
r = await req('GET', '/api/marketplaces/products');
assert(!r.data.products.some((p) => p.id === productId), 'архив скрыт из списка');
r = await req('DELETE', '/api/marketplaces/products/' + productId);
assert(r.status === 200, 'товар удалён');

console.log('\nALL MARKETPLACES API TESTS PASSED');
