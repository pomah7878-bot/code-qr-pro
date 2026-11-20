#!/usr/bin/env python3
"""Готовит позы робота-маскота из листа: обрезает по сетке и убирает белый фон (flood fill от краёв)."""
import sys
from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(__file__).resolve().parent.parent / 'docs' / 'mascot-sheet.png'
OUT = Path(__file__).resolve().parent.parent / 'web' / 'public' / 'mascot'
OUT.mkdir(parents=True, exist_ok=True)

# (row, col) → имя; лист 4 колонки × 3 строки
POSES = {
    'ask': (0, 0),      # «Задать вопрос» на синей пилюле
    'peek': (1, 2),     # выглядывает из-за белой пилюли «Нужна помощь?»
    'face': (1, 3),     # держит QR-планшет (лицо крупно)
    'think': (2, 1),    # задумчивый с лампочкой
    'support': (2, 0),  # «Написать в поддержку»
    'cheer': (2, 2),    # радуется
    'question': (1, 0), # со знаком вопроса
    'heart': (0, 1),    # сердце
    'thumbs': (0, 2),   # палец вверх
    'help': (0, 3),     # «Помощь по CODE QR PRO»
    'dark': (2, 3),     # «Есть вопрос?» на тёмной пилюле
    'tablet': (1, 1),   # очки и планшет
}


def remove_white(img: Image.Image, thr: int = 232) -> Image.Image:
    """Удаляет белый/светлый фон, заливая от краёв (замкнутые белые области остаются)."""
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]

    def is_bg(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a > 0 and r >= thr and g >= thr and b >= thr

    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))
    return img


def head_crop(source: str, out_name: str, box=(0.12, 0.0, 0.78, 0.60)) -> None:
    """Голова крупно — для круглой кнопки-аватара."""
    im = Image.open(OUT / f'{source}.png').convert('RGBA')
    w, h = im.size
    head = im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3])))
    bbox = head.getbbox()
    if bbox:
        pad = 4
        head = head.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(head.width, bbox[2] + pad), min(head.height, bbox[3] + pad)))
    head.save(OUT / out_name)
    print(f'{out_name}: {head.size[0]}x{head.size[1]}')


def main() -> int:
    sheet = Image.open(SRC).convert('RGBA')
    w, h = sheet.size
    cols, rows = 4, 3
    cw, ch = w / cols, h / rows
    for name, (row, col) in POSES.items():
        box = (int(col * cw), int(row * ch), int((col + 1) * cw), int((row + 1) * ch))
        cell = sheet.crop(box)
        cut = remove_white(cell)
        # обрезаем прозрачные поля
        bbox = cut.getbbox()
        if bbox:
            pad = 6
            left, top, right, bottom = bbox
            cut = cut.crop((max(0, left - pad), max(0, top - pad), min(cut.width, right + pad), min(cut.height, bottom + pad)))
        cut.save(OUT / f'{name}.png')
        print(f'{name}: {cut.size[0]}x{cut.size[1]}')

    head_crop('question', 'avatar.png', box=(0.16, 0.02, 0.70, 0.53))
    head_crop('heart', 'avatar-blink.png', box=(0.16, 0.01, 0.74, 0.50))
    return 0


if __name__ == '__main__':
    sys.exit(main())
