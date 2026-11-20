#!/usr/bin/env python3
"""Починка «кракозябр» (UTF-8, прочитанный как Windows-1251) в исходниках.

Сложность: в cp1251 есть неопределённые байты (0x98 и др.), поэтому строку
нельзя просто закодировать в cp1251 — собираем байты вручную: символы < 256
берём как есть, остальные кодируем в cp1251. Затем декодируем как UTF-8.
"""
import re
import sys
from pathlib import Path

ROOTS = ['web/src', 'server/src', 'deploy', 'scripts']
EXTS = {'.js', '.mjs', '.vue', '.yml', '.yaml', '.md', '.sh', '.json', '.css', '.html'}
MARKER = re.compile(r'вЂ|Р[џѕ°Ѓ‚„…†‡€‰‹‘’“”•–—™љ›њћџ]|С[‚ѓ„…†‡€‰‹‘’“”•–—™љ›њћџ]|Р[РС][а-яА-Я]')
CONTROL = re.compile('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]')


def to_bytes(line: str):
    out = bytearray()
    for ch in line:
        code = ord(ch)
        if code < 256:
            out.append(code)
            continue
        try:
            out.extend(ch.encode('cp1251'))
        except UnicodeEncodeError:
            return None
    return bytes(out)


def repair_line(line: str):
    if not MARKER.search(line):
        return None
    raw = to_bytes(line)
    if raw is None:
        return None
    try:
        fixed = raw.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if fixed == line or CONTROL.search(fixed):
        return None
    return fixed


def main(dry: bool) -> int:
    total = 0
    files = 0
    for root in ROOTS:
        base = Path(root)
        if not base.exists():
            continue
        for path in sorted(base.rglob('*')):
            if not path.is_file() or path.suffix not in EXTS:
                continue
            raw = path.read_text(encoding='utf-8')
            lines = raw.splitlines(keepends=True)
            changed = 0
            out = []
            for line in lines:
                fixed = repair_line(line)
                if fixed is None:
                    out.append(line)
                else:
                    out.append(fixed)
                    changed += 1
            if changed:
                files += 1
                total += changed
                print(f'{changed:4d}  {path.as_posix()}')
                if not dry:
                    path.write_text(''.join(out), encoding='utf-8', newline='')
    print(f'\nfiles: {files}, lines: {total}' + (' (dry-run)' if dry else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry' in sys.argv))
