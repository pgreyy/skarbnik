#!/usr/bin/env python3
# Builds web/data/judge.json, the data of the site's Judge guide page, from JUDGE_GUIDE.md, which is the source: the
# intro, the Level A steps (Do, Expect, Verify, What this proves, What it does not prove), the Level B table and the
# three lines of each Level B step, the notes under Level B, and every claim with its label and evidence. Inline
# Markdown (code, bold, links, bare addresses) becomes HTML; links to skarbnik.xyz become routes on the site, links to
# files in the repository become GitHub links. Fails if the guide's shape changes (steps, fields or claim count).
# Usage, from the repo root: python3 -I scripts/gen_judge_data.py
import html
import json
import re
import sys

SRC, OUT = 'JUDGE_GUIDE.md', 'web/data/judge.json'
REPO = 'https://github.com/pgreyy/skarbnik/blob/main/'
LABELS = {'Implemented': 'impl', 'Demonstrated': 'demo', 'Experimental': 'exp', 'Planned': 'plan', 'Not claimed': 'none'}
A_FIELDS = ['Do', 'Expect', 'Verify', 'What this proves', 'What it does not prove']
B_FIELDS = ['Expect', 'What this proves', 'What it does not prove']


def href(url):
    if url.startswith('https://skarbnik.xyz/'):
        return url[len('https://skarbnik.xyz/'):] or '#/', False
    if url.startswith('http'):
        return url, True
    return REPO + url, True


def inline(md):
    """Inline Markdown to HTML: code spans, links, bare https addresses, bold."""
    out, keep = html.escape(md, quote=False), []

    def hold(s):
        keep.append(s)
        return f'\x00{len(keep) - 1}\x00'
    out = re.sub(r'`([^`]+)`', lambda m: hold(f'<span class="mono">{m.group(1)}</span>'), out)

    def link(m):
        text, (url, ext) = m.group(1), href(m.group(2))
        text = re.sub(r'\x00(\d+)\x00', lambda k: keep[int(k.group(1))], text)
        cls = ' class="tx"' if 'nearblocks.io' in url else ''
        tgt = ' target="_blank" rel="noopener"' if ext else ''
        return hold(f'<a{cls} href="{html.escape(url)}"{tgt}>{text}</a>')
    out = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, out)
    out = re.sub(r'(?<![="\w])(https://[^\s<)]+[^\s<).,;])', lambda m: hold(
        (lambda u, e: f'<a href="{html.escape(u)}"{" target=\"_blank\" rel=\"noopener\"" if e else ""}>{m.group(1)}</a>')(*href(m.group(1)))), out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<b class="txt">\1</b>', out)
    while '\x00' in out:
        out = re.sub(r'\x00(\d+)\x00', lambda k: keep[int(k.group(1))], out)
    return out


def section(text, title):
    m = re.search(rf'^## {re.escape(title)}.*?$(.*?)(?=^## |\Z)', text, re.S | re.M)
    if not m:
        sys.exit(f'{SRC}: no section "## {title}"')
    return m.group(1).strip('\n')


def paras(block):
    """Plain paragraphs of a block (lines joined), skipping lists, tables and numbered items."""
    out = []
    for p in re.split(r'\n\s*\n', block.strip()):
        if p.lstrip().startswith(('-', '|')) or re.match(r'\s*\d+\.', p):
            continue
        out.append(inline(' '.join(l.strip() for l in p.splitlines())))
    return out


def fields(chunk, names):
    """Split 'Name: text' fields out of one step's text, in the given order."""
    flat = ' '.join(l.strip().lstrip('- ').strip() for l in chunk.splitlines())
    pat = '|'.join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    parts = re.split(rf'(?:^|\s)({pat}):\s', flat)
    got = {parts[i]: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    if list(got) != names:
        sys.exit(f'{SRC}: a step has fields {list(got)}, expected {names}:\n{flat[:160]}')
    return {k: inline(v) for k, v in got.items()}


def main():
    text = open(SRC, encoding='utf-8').read()
    intro = text.split('\n## ', 1)[0].split('\n', 1)[1]
    a = section(text, 'Level A')
    steps = []
    for m in re.finditer(r'^(\d+)\. \*\*(.+?)\*\* \(([^)]+)\)\n((?:   .*\n?)+)', a, re.M):
        steps.append({'n': m.group(1), 'title': inline(m.group(2)), 'time': m.group(3), **fields(m.group(4), A_FIELDS)})
    b = section(text, 'Level B')
    rows = [[c.strip() for c in l.strip().strip('|').split('|')] for l in b.splitlines() if re.match(r'\| B\d', l)]
    lines = {m.group(1): fields(m.group(2), B_FIELDS) for m in re.finditer(r'^- \*\*(B\d)\.\*\* (.+?)(?=^- \*\*B|\n\n|\Z)', b, re.M | re.S)}
    bsteps = [{'n': r[0], 'shows': inline(r[1]), 'needs': inline(r[2]), 'download': inline(r[3]), 'memory': inline(r[4]), **lines[r[0]]} for r in rows]
    bparas = paras(b)
    c = section(text, 'Claims and their evidence')
    claims = []
    for l in c.splitlines():
        cells = [x.strip() for x in l.strip().strip('|').split('|')] if l.startswith('| ') else None
        if not cells or cells[0] in ('Claim', '---'):
            continue
        if cells[1] not in LABELS:
            sys.exit(f'{SRC}: unknown label "{cells[1]}" for "{cells[0]}"')
        claims.append({'claim': inline(cells[0]), 'label': LABELS[cells[1]], 'evidence': inline(cells[2])})
    if len(steps) != 6 or len(bsteps) != len(lines) or len(bsteps) != 7 or not claims:
        sys.exit(f'{SRC}: found {len(steps)} Level A steps, {len(bsteps)} Level B rows, {len(lines)} Level B line sets, {len(claims)} claims')
    data = {'source': SRC, 'intro': paras(intro), 'a_intro': paras(a), 'a': steps, 'b_intro': [bparas[0]], 'b': bsteps,
            'b_notes': bparas[2:], 'claims_intro': paras(c), 'claims': claims}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{OUT}: {len(steps)} Level A steps, {len(bsteps)} Level B steps, {len(claims)} claims')


if __name__ == '__main__':
    main()
