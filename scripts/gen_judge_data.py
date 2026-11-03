#!/usr/bin/env python3
# Builds web/data/judge.json, the data of the site's Judge guide page, from JUDGE_GUIDE.md, which is the source, so the
# page and the file never differ. The guide has a title line, a one line lead, an intro, and four sections: Quick and
# Verify (numbered steps, each with its text, an optional command block, and the lines Button, Note, You should see,
# This shows, Does not show), Claims (a table: Claim, See it, Does not prove) and Limits (a list and a link). Any
# "#### Title" part under a section becomes a closed drop down on the page, with its paragraphs, lists, tables and
# command blocks. Inline Markdown (code, bold, links, bare addresses) becomes HTML; links to skarbnik.xyz become routes
# on the site, links to files in the repository become GitHub links. Fails if the guide's shape changes.
# Usage, from the repo root: python3 -I scripts/gen_judge_data.py
import html
import json
import re
import sys

SRC, OUT = 'JUDGE_GUIDE.md', 'web/data/judge.json'
REPO = 'https://github.com/pgreyy/skarbnik/blob/main/'
STEP_FIELDS = {'Button': 'button', 'Note': 'note', 'You should see': 'see', 'This shows': 'shows', 'Does not show': 'not'}


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


def chunks(block):
    """Split a block into paragraphs, lists, tables and command blocks: [(kind, lines)]."""
    out = []
    for p in re.split(r'\n\s*\n', block.strip('\n')):
        lines = p.split('\n')
        if all(l.startswith('    ') for l in lines):
            if out and out[-1][0] == 'code':
                out[-1][1].extend(l[4:] for l in lines)
            else:
                out.append(('code', [l[4:] for l in lines]))
        elif lines[0].startswith('| '):
            out.append(('table', lines))
        elif lines[0].startswith('- '):
            items = []
            for l in lines:
                if l.startswith('- '):
                    items.append(l[2:].strip())
                else:
                    items[-1] += ' ' + l.strip()
            out.append(('list', items))
        else:
            out.append(('p', [' '.join(l.strip() for l in lines)]))
    return out


def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def block_html(block):
    """A drop down's body: paragraphs, lists, tables and command blocks as HTML."""
    parts = []
    for kind, lines in chunks(block):
        if kind == 'p':
            parts.append(f'<p class="small">{inline(lines[0])}</p>')
        elif kind == 'list':
            parts.append('<ul class="jg-ul">' + ''.join(f'<li class="small">{inline(i)}</li>' for i in lines) + '</ul>')
        elif kind == 'code':
            parts.append({'cmd': '\n'.join(lines)})
        else:
            head, rows = cells(lines[0]), [cells(l) for l in lines[2:]]
            parts.append({'table': {'head': [inline(h) for h in head], 'rows': [[inline(c) for c in r] for r in rows]}})
    return parts


def split_h(text, level):
    """Split text at headings of one level: (lead text, [(title, body)])."""
    pat = re.compile(rf'^{"#" * level} (.+)$', re.M)
    ms = list(pat.finditer(text))
    lead = text[:ms[0].start()] if ms else text
    return lead, [(m.group(1).strip(), text[m.end():ms[i + 1].start() if i + 1 < len(ms) else len(text)]) for i, m in enumerate(ms)]


def step(title, body):
    m = re.fullmatch(r'(\d+)\. (.+)', title)
    if not m:
        sys.exit(f'{SRC}: a step title must be "N. Title", not "{title}"')
    s = {'n': m.group(1), 'title': inline(m.group(2)), 'text': [], 'cmds': [], 'button': None, 'note': None}
    for kind, lines in chunks(body):
        if kind == 'p':
            s['text'].append(inline(lines[0]))
        elif kind == 'code':
            s['cmds'].append('\n'.join(lines))
        elif kind == 'list':
            for item in lines:
                f = re.match(r'(Button|Note|You should see|This shows|Does not show): (.+)', item)
                if not f:
                    sys.exit(f'{SRC}: step {s["n"]} has a line that is not a known field: {item[:80]}')
                key = STEP_FIELDS[f.group(1)]
                if key == 'button':
                    b = re.fullmatch(r'\[([^\]]+)\]\(([^)\s]+)\)', f.group(2))
                    url, ext = href(b.group(2))
                    s['button'] = {'label': html.escape(b.group(1)), 'href': url, 'ext': ext}
                else:
                    s[key] = inline(f.group(2))
        else:
            sys.exit(f'{SRC}: step {s["n"]} has a table; steps hold text, commands and fields only')
    for k in ('see', 'shows', 'not'):
        if k not in s:
            sys.exit(f'{SRC}: step {s["n"]} ("{m.group(2)}") has no "{[n for n, v in STEP_FIELDS.items() if v == k][0]}" line')
    return s


def main():
    text = open(SRC, encoding='utf-8').read()
    top, secs = split_h(text, 2)
    title, *rest = [p for p in re.split(r'\n\s*\n', top.split('\n', 1)[1].strip())]
    data = {'source': SRC, 'h1': inline(title.strip()), 'lead': inline(' '.join(rest[0].split())),
            'intro': [inline(' '.join(p.split())) for p in rest[1:]]}
    names = [t.split(' (')[0] for t, _ in secs]
    if names != ['Quick', 'Verify', 'Claims', 'Limits']:
        sys.exit(f'{SRC}: sections are {names}, expected Quick, Verify, Claims, Limits')
    for (t, body), key in zip(secs, ['quick', 'verify', 'claims', 'limits']):
        main_part, more = split_h(body, 4)
        lead, steps = split_h(main_part, 3)
        sec = {'title': t, 'intro': [], 'steps': [step(st, sb) for st, sb in steps],
               'more': [{'title': inline(mt), 'body': block_html(mb)} for mt, mb in more]}
        for kind, lines in chunks(lead):
            if kind == 'p':
                sec['intro'].append(inline(lines[0]))
            elif kind == 'table':
                head = cells(lines[0])
                if head != ['Claim', 'See it', 'Does not prove']:
                    sys.exit(f'{SRC}: the Claims table must have the columns Claim, See it, Does not prove; it has {head}')
                sec['rows'] = [{'claim': inline(r[0]), 'see': inline(r[1]), 'not': inline(r[2])} for r in map(cells, lines[2:])]
            elif kind == 'list':
                sec['items'] = [inline(i) for i in lines]
            else:
                sys.exit(f'{SRC}: a command block outside a step in {t}')
        data[key] = sec
    q, v, c, lim = data['quick'], data['verify'], data['claims'], data['limits']
    if len(q['steps']) != 4 or len(v['steps']) != 3 or len(c.get('rows', [])) != 6 or not lim.get('items'):
        sys.exit(f'{SRC}: found {len(q["steps"])} Quick steps, {len(v["steps"])} Verify steps, {len(c.get("rows", []))} claims, '
                 f'{len(lim.get("items", []))} limits; expected 4, 3, 6 and a list')
    # the link under the limits list: the last paragraph of the section, one link only
    link = re.fullmatch(r'<a href="([^"]+)"[^>]*>(.+)</a>', lim['intro'][-1]) if lim['intro'] else None
    if not link:
        sys.exit(f'{SRC}: Limits must end with one link to the full list')
    lim['link'] = {'href': link.group(1), 'label': link.group(2)}
    lim['intro'] = lim['intro'][:-1]
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{OUT}: {len(q["steps"])} Quick steps, {len(v["steps"])} Verify steps, {len(c["rows"])} claims, '
          f'{len(lim["items"])} limits, {sum(len(s["more"]) for s in (q, v, c, lim))} drop downs')


if __name__ == '__main__':
    main()
