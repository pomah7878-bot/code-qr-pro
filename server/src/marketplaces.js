// Раздел «Маркетплейсы»: версионируемые профили этикеток площадок.
// Размеры и поля — из официальных страниц площадок (sourceUrl + verifiedAt).
// Профиль без источника помечается «Требует проверки» и не выдаётся как готовый.
// Товарные этикетки генерируются движком labels.js; транспортные оригиналы
// (стикер заказа WB, этикетка отправления Ozon/ЯМ) печатаются без перерисовки.

export const MARKETPLACES = [
  { id: 'wildberries', title: 'Wildberries', short: 'WB' },
  { id: 'ozon', title: 'Ozon', short: 'OZ' },
  { id: 'yandex_market', title: 'Яндекс Маркет', short: 'ЯМ' }
];

const MP_IDS = new Set(MARKETPLACES.map((m) => m.id));
export const isMarketplace = (id) => MP_IDS.has(String(id || ''));

const VERIFIED_AT = '2026-11-25';
const SRC_WB_STICKER = 'https://seller.wildberries.ru/instructions/ru/ru/material/step-two-items-packing-and-labeling-in-fbs';
const SRC_WB_CODES = 'https://seller.wildberries.ru/instructions/ru/ru/material/items-and-shipment-labling-like-barcode-and-others';
const SRC_OZON_BARCODE = 'https://seller-edu.ozon.ru/libra/work-with-goods/trebovaniya-k-kartochkam-tovarov/product-information/rabota-so-shtrihkodami';
const SRC_OZON_FBS = 'https://seller.ozon.ru/media/news/fbs-chto-novogo-v-formirovanii-etiketok/';
const SRC_YM_LABEL = 'https://yandex.ru/support/marketplace/ru/orders/fbs/packaging/marking';
const SRC_YM_PRODUCT = 'https://yandex.ru/support/marketplace/ru/storage/shipment/preparation/marking';

// Поля товара, которые профиль может требовать.
export const PRODUCT_FIELDS = ['name', 'manufacturer', 'produced_at', 'brand', 'sku', 'gtin', 'barcode', 'size', 'color', 'composition', 'batch', 'expires_at', 'code'];

function profile(p) {
  return {
    version: 1,
    dpi: 203,
    requiresCheck: !(p.sourceUrl && p.verifiedAt),
    requiredFields: [],
    notes: [],
    generatable: p.kind === 'product',
    ...p
  };
}

// Товарные макеты: элементы в мм, как в редакторе этикеток (labels.js).
function wbProductElements(W, H) {
  const m = Math.max(1.2, Math.min(2.5, Math.min(W, H) * 0.05));
  const bcH = Math.min(13, Math.max(8, H * 0.32));
  const els = [{ id: 'wbBarcode', type: 'code128', field: 'barcode', x: m, y: m, w: W - 2 * m, h: bcH, fontSize: 7, align: 'left' }];
  let y = m + bcH + 1.2;
  const lineH = Math.max(2.6, Math.min(4, H * 0.1));
  for (const key of ['name', 'brand', 'color', 'size', 'sku', 'manufacturer']) {
    if (y + lineH > H - m) break;
    els.push({ id: 'wb_' + key, type: 'field', field: key, x: m, y, w: W - 2 * m, h: lineH, fontSize: 6.5, align: 'left' });
    y += lineH + 0.5;
  }
  return els;
}

function ozonProductElements(W, H) {
  const m = Math.max(1, Math.min(2, Math.min(W, H) * 0.05));
  const bcH = Math.min(14, Math.max(7, H * 0.38));
  const els = [{ id: 'ozBarcode', type: 'ean13', field: 'barcode', x: m, y: m, w: W - 2 * m, h: bcH, fontSize: 6, align: 'left' }];
  let y = m + bcH + 1;
  const lineH = Math.max(2.4, Math.min(3.8, H * 0.1));
  for (const key of ['sku', 'name']) {
    if (y + lineH > H - m) break;
    els.push({ id: 'oz_' + key, type: 'field', field: key, x: m, y, w: W - 2 * m, h: lineH, fontSize: 6, align: 'left' });
    y += lineH + 0.4;
  }
  return els;
}

function ymProductElements(W, H) {
  const m = 2;
  const els = [
    { id: 'ymName', type: 'field', field: 'name', x: m, y: m, w: W - 2 * m, h: 5, fontSize: 7, align: 'left' },
    { id: 'ymComposition', type: 'field', field: 'composition', x: m, y: m + 5.5, w: W - 2 * m, h: 5, fontSize: 5.5, align: 'left' },
    { id: 'ymBarcode', type: 'ean13', field: 'barcode', x: m, y: m + 11.5, w: W - 2 * m, h: 12, fontSize: 6, align: 'left' },
    { id: 'ymDates', type: 'field', field: 'dates', x: m, y: m + 24.5, w: W - 2 * m, h: 3.5, fontSize: 6, align: 'left' },
    { id: 'ymManufacturer', type: 'field', field: 'manufacturer', x: m, y: m + 28.5, w: W - 2 * m, h: 3.5, fontSize: 6, align: 'left' }
  ];
  return els.filter((el) => el.y + el.h <= H - 1);
}

export const PROFILES = [
  // --- Товарные этикетки (генерируются) ---
  profile({
    id: 'wb-product-58x40', marketplace: 'wildberries', kind: 'product',
    name: 'WB · баркод товара · 58×40', widthMm: 58, heightMm: 40,
    requiredFields: ['name', 'barcode'],
    sourceUrl: SRC_WB_CODES, verifiedAt: VERIFIED_AT,
    notes: [
      'Баркод: рекомендуемый формат Code-128; при ведущем нуле — только Code-128.',
      'Символы баркода должны совпадать: товар = карточка = поставка.',
      'Размер 58×40 — ходовой; Wildberries не нормирует размер товарного баркода («формат может быть любым»).',
      'КИЗ (DataMatrix) для маркируемых категорий печатайте в «Генерации» или «Повторной печати».'
    ],
    elements: wbProductElements(58, 40)
  }),
  profile({
    id: 'wb-product-43x25', marketplace: 'wildberries', kind: 'product',
    name: 'WB · баркод товара · 43×25', widthMm: 43, heightMm: 25,
    requiredFields: ['name', 'barcode'],
    sourceUrl: SRC_WB_CODES, verifiedAt: VERIFIED_AT,
    notes: ['Компактный вариант; требования к баркоду те же (Code-128, совпадение в трёх местах).'],
    elements: wbProductElements(43, 25)
  }),
  profile({
    id: 'ozon-product-58x40', marketplace: 'ozon', kind: 'product',
    name: 'Ozon · штрихкод товара · 58×40', widthMm: 58, heightMm: 40,
    requiredFields: ['name', 'barcode'],
    sourceUrl: SRC_OZON_BARCODE, verifiedAt: VERIFIED_AT,
    notes: [
      'Ozon: EAN-8/13/14, UPC-12, Code 39, ISBN. DataMatrix как баркод товара не поддерживается.',
      'На этикетке: код, артикул, название товара. Штрихкод на товаре должен быть один и совпадать с кабинетом.',
      'Размеры 30×20 / 43×25 / 58×40 мм — варианты Ozon для обычного принтера.'
    ],
    elements: ozonProductElements(58, 40)
  }),
  profile({
    id: 'ozon-product-43x25', marketplace: 'ozon', kind: 'product',
    name: 'Ozon · штрихкод товара · 43×25', widthMm: 43, heightMm: 25,
    requiredFields: ['name', 'barcode'],
    sourceUrl: SRC_OZON_BARCODE, verifiedAt: VERIFIED_AT,
    notes: ['Средний вариант Ozon; поля: код, артикул, название.'],
    elements: ozonProductElements(43, 25)
  }),
  profile({
    id: 'ozon-product-30x20', marketplace: 'ozon', kind: 'product',
    name: 'Ozon · штрихкод товара · 30×20', widthMm: 30, heightMm: 20,
    requiredFields: ['barcode'],
    sourceUrl: SRC_OZON_BARCODE, verifiedAt: VERIFIED_AT,
    notes: ['Маленький вариант Ozon; проверьте читаемость сканером перед партией.'],
    elements: ozonProductElements(30, 20)
  }),
  profile({
    id: 'ym-product-58x40', marketplace: 'yandex_market', kind: 'product',
    name: 'ЯМ · этикетка товара · 58×40', widthMm: 58, heightMm: 40,
    requiredFields: ['name'],
    sourceUrl: SRC_YM_PRODUCT, verifiedAt: VERIFIED_AT,
    notes: [
      'Яндекс Маркет: размер любой, главное — читаемость. 58×40 — наш ходовой макет.',
      'Обязательно: название как в карточке, описание/состав на русском, штрихкод (если нет на товаре), срок годности для товаров со сроком.',
      'Этикетка не нужна, если вся информация на русском уже есть на товаре.',
      'Маркировка «Честный ЗНАК» — если товар подлежит маркировке (DataMatrix печатайте в «Генерации»).'
    ],
    elements: ymProductElements(58, 40)
  }),
  // --- Транспортные этикетки (оригинал из кабинета, печать без перерисовки) ---
  profile({
    id: 'wb-fbs-sticker-40x58', marketplace: 'wildberries', kind: 'shipping',
    name: 'WB · стикер заказа FBS · 40×58', widthMm: 40, heightMm: 58,
    sourceUrl: SRC_WB_STICKER, verifiedAt: VERIFIED_AT,
    notes: [
      'Стикер заказа формируется в кабинете WB (Поставки и заказы → Печать стикеров) — загрузите готовый PDF.',
      'Печать: масштаб 100%, полей нет, чёрно-белая. QR должен читаться камерой смартфона.',
      'Стикер обязателен на каждую упакованную единицу; не клейте рядом с баркодом.'
    ]
  }),
  profile({
    id: 'ozon-fbs-120x75', marketplace: 'ozon', kind: 'shipping',
    name: 'Ozon · этикетка отправления FBS · 120×75', widthMm: 120, heightMm: 75,
    sourceUrl: SRC_OZON_FBS, verifiedAt: VERIFIED_AT,
    notes: ['Оригинал из кабинета Ozon; печатайте без масштабирования. На новых складах по умолчанию 58×40 — переключается в настройках метода.']
  }),
  profile({
    id: 'ozon-fbs-58x40', marketplace: 'ozon', kind: 'shipping',
    name: 'Ozon · этикетка отправления FBS · 58×40', widthMm: 58, heightMm: 40,
    sourceUrl: SRC_OZON_FBS, verifiedAt: VERIFIED_AT,
    notes: ['Компактный формат Ozon для новых складов; оригинал из кабинета, без перерисовки.']
  }),
  profile({
    id: 'ym-fbs-120x75', marketplace: 'yandex_market', kind: 'shipping',
    name: 'ЯМ · ярлык на заказ FBS · 120×75', widthMm: 120, heightMm: 75,
    sourceUrl: SRC_YM_LABEL, verifiedAt: VERIFIED_AT,
    notes: [
      'Ярлык формируется в кабинете (Заказы и отгрузки → Распечатать ярлык) — загрузите готовый PDF.',
      'На лист А4 помещается 8 ярлыков 120×75. В ряде городов (DPD) рекомендуется 120×75.',
      'Для каждого заказа — новый актуальный ярлык; старые наклейки снять.'
    ]
  }),
  profile({
    id: 'ym-fbs-58x40', marketplace: 'yandex_market', kind: 'shipping',
    name: 'ЯМ · ярлык на заказ FBS · 58×40', widthMm: 58, heightMm: 40,
    sourceUrl: SRC_YM_LABEL, verifiedAt: VERIFIED_AT,
    notes: ['Компактный ярлык; на А4 — 21 шт. Оригинал из кабинета, без перерисовки.']
  }),
  // --- Черновики: пока без официального подтверждения ---
  profile({
    id: 'ozon-fbo-cargo-120x75', marketplace: 'ozon', kind: 'shipping',
    name: 'Ozon · этикетка грузоместа FBO · 120×75', widthMm: 120, heightMm: 75,
    notes: ['Требует проверки: размер и поля грузоместа FBO не подтверждены официальной страницей. Используйте оригинал из кабинета.']
  })
];

export function profileById(id) {
  return PROFILES.find((p) => p.id === String(id || '')) || null;
}

export function publicProfiles() {
  return PROFILES.map((p) => ({
    id: p.id, marketplace: p.marketplace, kind: p.kind, name: p.name,
    widthMm: p.widthMm, heightMm: p.heightMm, dpi: p.dpi, version: p.version,
    sourceUrl: p.sourceUrl || '', verifiedAt: p.verifiedAt || '',
    requiresCheck: p.requiresCheck, requiredFields: p.requiredFields,
    notes: p.notes, generatable: p.generatable
  }));
}

export function ean13Valid(digits) {
  const s = String(digits || '').replace(/\s+/g, '');
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10) === s[12];
}

// Проверка данных товара под профиль: проблемы блокируют печать, предупреждения — нет.
export function validateProduct(profile, fields) {
  const problems = [];
  const warnings = [];
  const f = fields || {};
  for (const key of profile.requiredFields || []) {
    if (!String(f[key] || '').trim()) problems.push('Заполните обязательное поле: ' + fieldTitle(key));
  }
  const barcode = String(f.barcode || '').trim();
  if (barcode) {
    const compact = barcode.replace(/\s+/g, '');
    if (/^\d{13}$/.test(compact) && !ean13Valid(compact)) problems.push('EAN-13: неверная контрольная цифра');
    if (/^\d{12}$/.test(compact)) warnings.push('EAN-13 введён без контрольной цифры — она будет вычислена автоматически');
    if (!/^[\dA-Za-z\-.$/+% ]{1,64}$/.test(compact)) problems.push('Штрихкод: допустимы цифры, латиница и символы - . $ / + %');
  } else if ((profile.requiredFields || []).includes('barcode')) {
    // уже отмечено выше
  } else {
    warnings.push('Штрихкод не указан — этикетка будет без кода');
  }
  if (profile.marketplace === 'yandex_market' && !String(f.composition || '').trim()) {
    warnings.push('Яндекс Маркет требует описание/состав на русском языке');
  }
  if (!String(f.manufacturer || '').trim()) warnings.push('Не указан изготовитель');
  return { problems, warnings };
}

export function fieldTitle(key) {
  return {
    name: 'Наименование изделия', manufacturer: 'Изготовитель', produced_at: 'Дата изготовления',
    brand: 'Бренд', sku: 'Артикул продавца', gtin: 'GTIN', barcode: 'Штрихкод (EAN-13/Code-128)',
    size: 'Размер', color: 'Цвет', composition: 'Состав/описание', batch: 'Партия/серия',
    expires_at: 'Годен до', code: 'Код маркировки (КИЗ)'
  }[key] || key;
}

// Строка данных для движка labels.js: склеиваем даты в одно поле для макета ЯМ.
export function toDataRow(fields) {
  const f = {};
  for (const key of PRODUCT_FIELDS) f[key] = String(fields?.[key] ?? '').trim().slice(0, 1000);
  const dates = [];
  if (f.produced_at) dates.push('Изготовлено: ' + f.produced_at);
  if (f.expires_at) dates.push('Годен до: ' + f.expires_at);
  f.dates = dates.join(' · ');
  return f;
}

export function buildTemplate(profile) {
  return {
    name: profile.name,
    widthMm: profile.widthMm,
    heightMm: profile.heightMm,
    dpi: profile.dpi,
    elements: profile.elements || []
  };
}
