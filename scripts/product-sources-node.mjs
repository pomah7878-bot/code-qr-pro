// Проверяем из Node доступность ЧЗ True API и открытых баз (как будет ходить сервер).
const tests = [
  { name: 'cz-true-api', url: 'https://api.mdlp.crpt.ru/api/v3/true-api/cises/info', method: 'POST', body: '["0104638230913287215ZsWrd"]' },
  { name: 'off-nutella', url: 'https://world.openfoodfacts.org/api/v2/product/3017620422003.json?fields=code,product_name,brands,quantity,categories' },
  { name: 'obf-nutella', url: 'https://world.openbeautyfacts.org/api/v2/product/3017620422003.json?fields=code,product_name,brands,quantity,categories' }
];

for (const t of tests) {
  try {
    const res = await fetch(t.url, {
      method: t.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CODE-QR-PRO/1.0 (support@code-qr.stockcity.ru)' },
      body: t.body,
      signal: AbortSignal.timeout(12000)
    });
    const text = await res.text();
    console.log(t.name, 'http:', res.status, 'body:', text.slice(0, 160).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(t.name, 'error:', e.message, e.cause && e.cause.code);
  }
}
