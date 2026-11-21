# Проверка Sitemap перед добавлением в Яндекс Вебмастер

Дата проверки: 21.11.2026.

URL: **https://code-qr.stockcity.ru/sitemap.xml**

## Итог: можно добавлять

| Проверка | Результат |
|---|---|
| HTTP-статус | **200 OK** |
| Content-Type | `application/xml` |
| Размер | 4 456 байт (лимит 50 МБ) |
| URL в sitemap | **43** (лимит 50 000) |
| XML | валидный, namespace `http://www.sitemaps.org/schemas/sitemap/0.9` |
| Дубли URL | нет |
| Чужой хост / http | нет, все URL на `https://code-qr.stockcity.ru` |
| Закрытые в robots URL | нет (`/app/`, `/api/`, `/login`, `/register` отсутствуют) |
| `lastmod` | у всех 43 URL, формат `YYYY-MM-DD`, дат в будущем нет |
| Ответы всех URL | **43/43 — 200**, без редиректов |
| Canonical в исходном HTML | **43/43 совпадает с URL из sitemap** |
| `meta robots` | `index, follow`, без `noindex` |
| `robots.txt` | содержит `Sitemap: https://code-qr.stockcity.ru/sitemap.xml` |
| Доступ для YandexBot | 200, `application/xml` |

Проверка выполнена от имени User-Agent YandexBot. Все 43 страницы обошёл без рендера JS и сверил canonical/title/description.

## Что было исправлено перед добавлением

В исходном `index.html` canonical был жёстко прописан на `https://code-qr.stockcity.ru/` — до выполнения клиентского JS все статьи и публичные страницы выглядели дублями главной. Добавил серверную подстановку `title`, `description`, `canonical`, `og:*` и `twitter:*` для:

- `/`, `/pricing`, `/articles`, `/faq`, `/offer`, `/terms`, `/privacy`;
- всех `/articles/<slug>` из базы знаний.

Теперь робот видит правильный canonical сразу в HTML, а после гидрации SPA значения совпадают.

## Как добавить в Яндекс Вебмастер

1. Открыть **Яндекс Вебмастер → Индексирование → Файлы Sitemap**.
2. Добавить: `https://code-qr.stockcity.ru/sitemap.xml`.
3. После добавления подождать обработки и запросить переобход ключевых страниц.
4. Проверить через несколько дней: число URL, ошибки, «Страницы в поиске».

Sitemap динамический: при публикации новой статьи она автоматически появляется в файле.
