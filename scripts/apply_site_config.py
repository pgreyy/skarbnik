#!/usr/bin/env python3
# Writes the site's own address (site_url in web/site.config.json, the one place it is set) into the files that cannot
# read the config when they load: the meta tags of web/index.html (canonical, og:url, og:image), web/sitemap.xml,
# web/robots.txt, the "Site:" line of web/agent-quickstart.txt, the README and docs/ARCHITECTURE.md. It remembers the
# address it last wrote (scripts/site_url.applied), so after changing site_url in the config one run updates every
# file. The network, contract, RPC and explorer are read by the site itself (web/js/config.js) and by the feed and
# site data generators. Usage, from the repo root: python3 -I scripts/apply_site_config.py
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(ROOT, "web/site.config.json")))
url = cfg["site_url"].rstrip("/")
state = os.path.join(ROOT, "scripts/site_url.applied")
old = {"https://skarbnik-near.vercel.app"}
if os.path.exists(state):
    old.add(open(state).read().strip())
old.discard(url)


def update(rel, fn):
    p = os.path.join(ROOT, rel)
    s = open(p, encoding="utf-8").read()
    n = fn(s)
    if n != s:
        open(p, "w", encoding="utf-8").write(n)
        print("updated", rel)


def swap_old(s):
    for o in old:
        s = s.replace(o, url)
    return s


def index_html(s):
    s = swap_old(s)
    s = re.sub(r'<link rel="canonical" href="[^"]*">\n', "", s)
    s = re.sub(r'<meta property="og:url" content="[^"]*">\n', "", s)
    s = re.sub(r'(<meta property="og:image" content=")[^"]*(/social\.png\?v=s12">)', rf"\g<1>{url}\g<2>", s)
    return s.replace('<meta property="og:title"', f'<link rel="canonical" href="{url}/">\n<meta property="og:url" content="{url}/">\n<meta property="og:title"', 1)


update("web/index.html", index_html)
update("web/agent-quickstart.txt", lambda s: re.sub(r"^Site: .*$", f"Site: {url}   Feed: {url}/feed.json", swap_old(s), count=1, flags=re.M))
update("README.md", swap_old)
update("docs/ARCHITECTURE.md", swap_old)
for rel, text in (("web/sitemap.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
 <url><loc>{url}/</loc></url>
 <url><loc>{url}/feed.json</loc></url>
 <url><loc>{url}/agent-quickstart.txt</loc></url>
</urlset>
"""), ("web/robots.txt", f"User-agent: *\nAllow: /\nSitemap: {url}/sitemap.xml\n")):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p) or open(p).read() != text:
        open(p, "w").write(text)
        print("wrote", rel)
open(state, "w").write(url + "\n")
print("site_url:", url)
