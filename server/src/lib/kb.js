import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

/**
 * База знаний клиентского AI-помощника.
 * Статьи хранятся в БД (kb_articles) и наполняются из knowledge/articles.json
 * при старте: новые статьи добавляются, существующие обновляются по slug.
 */

const dir = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(dir, '..', 'knowledge', 'articles.json');

export function seedKnowledgeBase() {
  let articles = [];
  try {
    articles = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  } catch {
    return 0;
  }
  if (!Array.isArray(articles) || !articles.length) return 0;
  const upsert = db.prepare(
    `INSERT INTO kb_articles (slug, title, summary, body, tags)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       body = excluded.body,
       tags = excluded.tags,
       updated_at = datetime('now')`
  );
  const tx = db.transaction((list) => {
    for (const a of list) {
      upsert.run(String(a.slug), String(a.title || ''), String(a.summary || ''), String(a.body || ''), (a.tags || []).join(','));
    }
  });
  tx(articles);
  return articles.length;
}

const STOP = new Set([
  'это', 'как', 'что', 'для', 'или', 'при', 'без', 'так', 'уже', 'ещё', 'еще', 'мне', 'нам', 'вас', 'вам',
  'мой', 'моя', 'мои', 'всё', 'все', 'если', 'чтобы', 'можно', 'нужно', 'почему', 'когда', 'какой', 'какая',
  'какие', 'где', 'куда', 'откуда', 'есть', 'нет', 'был', 'была', 'были', 'будет', 'тоже', 'также', 'этот'
]);

function termsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function scoreText(terms, text, weight) {
  if (!terms.length) return 0;
  const words = new Set(termsOf(text));
  let score = 0;
  for (const t of terms) if (words.has(t)) score += weight;
  return score;
}

/** Поиск релевантных статей по вопросу (без внешних сервисов, быстро и бесплатно). */
export function searchKnowledge(query, limit = 4) {
  const terms = termsOf(query);
  const rows = db.prepare('SELECT id, slug, title, summary, body, tags FROM kb_articles WHERE published = 1').all();
  const scored = rows
    .map((r) => ({
      ...r,
      score: scoreText(terms, r.title, 6) + scoreText(terms, r.tags, 4) + scoreText(terms, r.summary, 2) + scoreText(terms, r.body, 1)
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

/** Текст статей для промпта: коротко, с жёстким лимитом символов (экономия токенов). */
export function kbContext(articles, maxChars = 2400) {
  const parts = [];
  let used = 0;
  for (const a of articles) {
    const chunk = `### ${a.title}\n${String(a.body || '').slice(0, 850)}`;
    if (used + chunk.length > maxChars) break;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join('\n\n');
}

export function markKbCalls(ids) {
  if (!ids?.length) return;
  const stmt = db.prepare('UPDATE kb_articles SET calls = calls + 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

export function listKbArticles() {
  return db.prepare(
    'SELECT id, slug, title, summary, tags, published, calls, updated_at FROM kb_articles ORDER BY title'
  ).all();
}

export function saveKbArticle({ id, slug, title, summary, body, tags, published }) {
  const cleanSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!cleanSlug || !String(title || '').trim()) throw new Error('Нужны slug и заголовок');
  if (id) {
    db.prepare(
      `UPDATE kb_articles SET slug=?, title=?, summary=?, body=?, tags=?, published=?, updated_at=datetime('now') WHERE id=?`
    ).run(cleanSlug, String(title).trim().slice(0, 200), String(summary || '').slice(0, 400), String(body || '').slice(0, 8000), String(tags || '').slice(0, 500), published ? 1 : 0, Number(id));
    return Number(id);
  }
  const info = db.prepare(
    'INSERT INTO kb_articles (slug, title, summary, body, tags, published) VALUES (?,?,?,?,?,?)'
  ).run(cleanSlug, String(title).trim().slice(0, 200), String(summary || '').slice(0, 400), String(body || '').slice(0, 8000), String(tags || '').slice(0, 500), published ? 1 : 0);
  return Number(info.lastInsertRowid);
}

export function deleteKbArticle(id) {
  db.prepare('DELETE FROM kb_articles WHERE id = ?').run(Number(id));
}
