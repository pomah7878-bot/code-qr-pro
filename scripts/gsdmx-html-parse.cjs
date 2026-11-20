// Разбор HTML gsdmx: формы, скрытые поля, возможные endpoint'ы.
const fs = require('node:fs');
const h = fs.readFileSync('/tmp/gsdmx.html', 'utf8');
const forms = [...h.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
console.log('forms:', JSON.stringify(forms.slice(0, 10), null, 1));
const inputs = [...h.matchAll(/<input[^>]*>/g)].map((m) => m[0]).slice(0, 20);
console.log('inputs:', JSON.stringify(inputs, null, 1));
const dataAttrs = [...h.matchAll(/data-[a-z-]+="[^"]*"/g)].map((m) => m[0]);
console.log('data-attrs:', JSON.stringify([...new Set(dataAttrs)].slice(0, 25), null, 1));
const buttons = [...h.matchAll(/<button[^>]*>[\s\S]{0,120}?<\/button>/g)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 160));
console.log('buttons:', JSON.stringify(buttons.slice(0, 10), null, 1));
const scriptsInline = [...h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].trim()).filter(Boolean);
console.log('inline scripts:', scriptsInline.length, JSON.stringify(scriptsInline.map((s) => s.slice(0, 200)).slice(0, 6), null, 1));
