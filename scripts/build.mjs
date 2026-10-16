/** Deterministic static build. No network, dependencies or application startup. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {exactEvidence} from './evidence.mjs';
import {escapeHTML as esc} from '../site/lib.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha = value => createHash('sha256').update(value).digest('hex');
const read = name => fs.readFile(path.join(root, name), 'utf8');
const json = async name => JSON.parse(await read(name));
const languages = ['en', 'pt'];
export const blocks = page => page.sections.flatMap(s => s.blocks || s.panels.flatMap(p => p.blocks));
export const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[e])).replace(/\s+/g, ' ').trim();

async function reviewHashes() {
  const files = (await fs.readdir(path.join(root,'content'))).filter(f => f.endsWith('.json') && f !== 'review.json').sort().map(f => 'content/'+f);
  files.push('sources/manifest.json');
  return Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(root,file)))])));
}

export async function loadContent() {
  const review = await json('content/review.json');
  assert.ok(review.reviewer?.trim(), 'Review identity is required');
  assert.deepEqual(review.files, await reviewHashes(), 'Editorial files changed: review both languages and record the review before building');
  const manifest = await json('sources/manifest.json'), references = await json('content/references.json');
  const pages = (await Promise.all((await fs.readdir(path.join(root, 'content'))).filter(f => f.endsWith('.json')).map(f => json('content/' + f))))
    .filter(data => data.sections).sort((a, b) => a.order - b.order);
  const documents = manifest.documents.filter(d => d.status === 'ok'), originals = new Map();
  for (const d of documents) {
    assert.ok(d.path.startsWith('sources/raw/') && !d.path.includes('..'), 'Invalid source path');
    const bytes = await fs.readFile(path.join(root, d.path));
    assert.equal(sha(bytes), d.sha256, `Source changed: ${d.path}`);
    assert.equal(bytes.length, d.bytes); originals.set(d.path, bytes.toString('utf8'));
  }
  assert.equal(documents.length, 714, 'The complete archived corpus must be preserved');
  const evidence = {};
  for (const [id, ref] of Object.entries(references)) {
    const doc = documents.find(d => d.path === ref.path);
    assert.ok(doc, `Unarchived reference: ${id}`); assert.equal(ref.sha256, doc.sha256);
    const source = originals.get(ref.path), selected = exactEvidence(source, ref);
    const url = new URL(doc.finalUrl);
    url.pathname = url.pathname.replace(/\.md$/, '');
    url.hash = ref.anchor || (selected.level > 1 ? ref.heading.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') : '');
    evidence[id] = {id, path:doc.path, title:source.split(/\r?\n/).find(s => s.startsWith('# '))?.slice(2) || doc.title,
      provider:doc.provider, url:url.href, section:ref.heading.replace(/^#+\s*/, ''), lines:[selected.from, selected.to], segments:ref.segments, quote:selected.quote};
  }
  const used = new Set(), ids = new Set(pages.map(p => p.id));
  assert.equal(ids.size, 21);
  for (const page of pages) {
    assert.deepEqual(page.sections.map(s => s.id), ['definition','operation','implementation']);
    assert.deepEqual(page.sections[2].panels.map(p => p.id), ['codex','claude','cursor']);
    for (const block of blocks(page)) {
      if (block.type === 'heading') { assert.ok(block.id); }
      else {
        assert.ok(block.references?.length, 'Every passage needs evidence');
        if (block.type !== 'note') assert.equal(block.references.length, 1);
        for (const id of block.references) {
          assert.ok(evidence[id], `Unknown reference: ${id}`); used.add(id);
          const citations = evidence[id].citations ||= [];
          citations.push({page:page.id, anchor:`cite-${id}-${citations.filter(c => c.page === page.id).length+1}`});
        }
      }
      if (block.type === 'code') {
        const dedent = s => s.split('\n').map(l => l.trimStart()).join('\n').trim();
        assert.ok(dedent(evidence[block.references[0]].quote).includes(dedent(block.code)), 'Example differs from original');
      } else for (const lang of languages) {
        assert.ok(block.text?.[lang]?.trim(), `Missing ${lang} text in ${page.id}`);
        assert.ok(!block.text[lang].includes('\uFFFD'), 'Invalid Unicode');
        for (const match of block.text[lang].matchAll(/\]\(([a-z0-9-]+)\.md(?:#[^)]+)?\)/g)) assert.ok(ids.has(match[1]), 'Unknown internal page');
        if (block.type !== 'heading') for (const match of block.text[lang].matchAll(/`([^`]+)`/g)) {
          assert.ok(block.references.some(id => evidence[id].quote.includes(match[1])), `Identifier outside evidence: ${match[1]}`);
        }
      }
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(references).sort(), 'Unused or missing evidence');
  return {pages, evidence, manifest, ui:await json('content/ui.json'), aliases:await json('content/aliases.json')};
}

export function inline(value, lang, prefix = '../../') {
  const codes = [];
  let text = value.replace(/`([^`]+)`/g, (_, code) => { codes.push(`<code>${esc(code)}</code>`); return `\u0001${codes.length - 1}\u0001`; });
  text = esc(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, target) => {
    let url = target.replaceAll('&amp;', '&');
    const local = url.match(/^([a-z0-9-]+)\.md(?:#([a-z0-9-]+))?$/);
    if (local) url = `${prefix}${lang}/${local[1]}/${local[2] ? '#' + local[2] : ''}`;
    else if (!url.startsWith('https://')) throw Error('Unsupported link: ' + url);
    return `<a href="${esc(url)}"${local ? '' : ' target="_blank" rel="noopener noreferrer"'}>${label}</a>`;
  }).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text.replace(/\u0001(\d+)\u0001/g, (_, n) => codes[n]);
}

function head(title, lang, prefix, description, alternate = '') {
  return `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="${esc(description)}"><title>${esc(title)} — Docs</title><link rel="icon" href="data:,"><link rel="stylesheet" href="${prefix}assets/style.css">${alternate}<script>try{const t=localStorage.getItem('docs:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}</script><script type="module" src="${prefix}assets/app.js"></script></head>`;
}
const dataScript = value => `<script id="ui-data" type="application/json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`;
function toolbar(t, prefix, lang, page = 'agents') {
  return `<header class="site-header"><div class="topbar"><div class="brand-area"><button class="icon-button mobile-menu" id="menu-toggle" aria-label="${t.menu}" aria-expanded="false" aria-controls="sidebar">☰</button><a class="brand" href="${prefix}${lang}/agents/">Docs</a></div><button id="search-open" class="search-trigger" aria-label="${t.search}"><span>${t.search}</span><kbd>Ctrl K</kbd></button><div class="top-actions"><label class="sr-only" for="language">${t.chooseLanguage}</label><select id="language" aria-label="${t.chooseLanguage}">${languages.map(l => `<option value="${prefix}${l}/${page}/"${lang === l ? ' selected' : ''}>${l === 'en' ? 'English' : 'Português'}</option>`).join('')}</select><button type="button" class="theme-toggle icon-button" data-theme-toggle aria-label="${t.light}">◐</button></div></div></header>`;
}
function dialogs(t) {
  return `<dialog id="search-dialog" aria-labelledby="search-label"><div class="search-box"><label id="search-label" class="sr-only" for="search-input">${t.search}</label><input id="search-input" type="search" placeholder="${t.search}…" autocomplete="off"><button id="search-close" aria-label="${t.closeSearch}">Esc</button></div><div id="search-results" aria-live="polite"></div><div class="search-hint">${t.searchHint}</div></dialog><div id="evidence-popup" role="dialog" aria-modal="false" aria-labelledby="evidence-title" hidden><div class="evidence-heading"><div><span class="evidence-eyebrow">${t.original}</span><p id="evidence-title"></p></div><button type="button" data-evidence-close aria-label="${t.closeOriginal}">×</button></div><p id="evidence-meta"></p><pre id="evidence-quote" lang="en" tabindex="0"></pre><div class="evidence-links"><a id="evidence-local" target="_blank" rel="noopener noreferrer">${t.readOriginal} ↗</a><a id="evidence-official" target="_blank" rel="noopener noreferrer">${t.official} ↗</a></div></div><div id="toast" role="status" aria-live="polite"></div>`;
}

function renderPage(page, lang, data) {
  const t = data.ui[lang], index = [], used = [], occurrences = new Map(), outline = [];
  const cite = id => {
    if (!used.includes(id)) used.push(id);
    const occurrence = (occurrences.get(id) || 0) + 1; occurrences.set(id, occurrence);
    return `<sup id="cite-${id}-${occurrence}"><a class="citation-link" data-source="${id}" href="../../source.html?ref=${id}&lang=${lang}#excerpt-1" target="_blank" rel="noopener noreferrer" aria-haspopup="dialog" aria-controls="evidence-popup" aria-expanded="false" aria-label="${t.reference} ${used.indexOf(id) + 1}">[${used.indexOf(id) + 1}]</a></sup>`;
  };
  function renderBlocks(items, section, provider = '') {
    let output = '', list = '', current = provider ? {
      page:page.id, title:page.title[lang]+' · '+({codex:'Codex',claude:'Claude Code',cursor:'Cursor'}[provider]),
      anchor:'panel-'+provider, text:''
    } : null;
    const finish = () => { if (current) index.push(current); };
    for (const b of items) {
      const tag = b.type === 'item' ? (b.ordered ? 'ol' : 'ul') : '';
      if (tag !== list) { if (list) output += `</${list}>`; if (tag) output += `<${tag}>`; list = tag; }
      if (b.type === 'heading') {
        finish(); current = {page:page.id, title:b.text[lang] + (provider ? ' · ' + provider : ''), anchor:b.id, text:''};
        outline.push({id:b.id, title:b.text[lang], provider, depth:b.level - (provider ? 3 : 2)});
        output += `<h${b.level} id="${b.id}">${esc(b.text[lang])}<a class="heading-anchor" href="#${b.id}" aria-label="${esc(b.text[lang])}">#</a></h${b.level}>`; continue;
      }
      const citations = b.references.map(cite).join(' '), attrs = b.type === 'note' ? '' : ` class="evidence-passage" data-source="${b.references[0]}"`;
      const text = b.type === 'code' ? b.code : b.text[lang];
      if (current) current.text += ' ' + (b.type === 'code' ? text : plain(inline(text, lang)));
      if (b.type === 'code') output += `<div${attrs}><div class="code-block"><div class="code-header"><span>${esc(b.language)}</span><button data-copy aria-label="${t.copyCode}">${t.copy}</button></div><pre><code>${esc(b.code)}</code></pre></div>${citations}</div>`;
      else if (b.type === 'table') {
        const rows = b.text[lang].split('\n').filter(l => l.startsWith('|')).map(l => l.split('|').slice(1,-1).map(c => c.trim()));
        output += `<div${attrs}><div class="table-wrap"><table><thead><tr>${rows[0].map(c => `<th scope="col">${inline(c,lang)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(r => `<tr>${r.map(c => `<td>${inline(c,lang)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${citations}</div>`;
      } else if (b.type === 'note') output += `<blockquote><strong>${t.note}.</strong> ${inline(text,lang)} ${citations}</blockquote>`;
      else output += `<${tag ? 'li' : 'p'}${attrs}>${inline(text,lang)} ${citations}</${tag ? 'li' : 'p'}>`;
    }
    if (list) output += `</${list}>`; finish(); return output;
  }
  const sections = page.sections.map(s => {
    outline.push({id:s.id,title:t.sections[s.id],depth:0});
    const content = s.blocks ? renderBlocks(s.blocks,s.id) : `<div class="provider-tabs" role="tablist" aria-label="${t.implementation}" hidden>${s.panels.map((p,i) => `<button id="tab-${p.id}" class="provider-tab" role="tab" data-provider="${p.id}" aria-controls="panel-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${p.label}</button>`).join('')}</div>${s.panels.map(p => `<div id="panel-${p.id}" class="provider-panel" data-panel="${p.id}"><h3 class="provider-title">${p.label}</h3>${renderBlocks(p.blocks,s.id,p.id)}</div>`).join('')}`;
    index.push({page:page.id,title:page.title[lang]+' · '+t.sections[s.id],anchor:s.id,text:plain(content)});
    return `<section class="content-section" id="${s.id}"><h2>${t.sections[s.id]}<a class="heading-anchor" href="#${s.id}" aria-label="${t.sections[s.id]}">#</a></h2>${content}</section>`;
  }).join('');
  const bibliography = used.map((id,n) => {
    const e=data.evidence[id];
    return `<details id="ref-${id}" data-original="${id}"><summary><span>[${n+1}] ${esc(e.title)}</span><small>${esc(e.section)} · ${t.lines} ${e.lines.join('–')}</small></summary><div class="reference-body"><a class="original-local" href="../../source.html?ref=${id}&lang=${lang}#excerpt-1" target="_blank" rel="noopener noreferrer">${t.readOriginal} ↗</a> · <a class="original-official" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${t.official} ↗</a><pre lang="en">${esc(e.quote).replaceAll('\r','&#13;')}</pre><div>${Array.from({length:occurrences.get(id)},(_,i)=>`<a href="#cite-${id}-${i+1}">${t.back} ${i+1} ↩</a>`).join(' · ')}</div></div></details>`;
  }).join('');
  outline.push({id:'references',title:t.sections.references,depth:0});
  index.unshift({page:page.id,title:page.title[lang],anchor:'',text:data.ui[lang].groups[page.group]});
  const sidebar = Object.keys(t.groups).map(group => `<div class="nav-group"><p class="nav-group-title">${t.groups[group]}</p>${data.pages.filter(p=>p.group===group).map(p=>`<a class="nav-link${p.id===page.id?' active':''}"${p.id===page.id?' aria-current="page"':''} href="../../${lang}/${p.id}/">${esc(p.title[lang])}</a>`).join('')}</div>`).join('');
  const position=data.pages.indexOf(page), previous=data.pages[position-1], next=data.pages[position+1];
  const alternate=languages.map(l=>`<link rel="alternate" hreflang="${data.ui[l].htmlLanguage}" href="../../${l}/${page.id}/">`).join('');
  const html = head(page.title[lang],t.htmlLanguage,'../../',t.description,alternate)+`<body data-language="${lang}" data-root="../../"><a class="skip" href="#main">${t.skip}</a>${toolbar(t,'../../',lang,page.id)}<nav class="topnav" aria-label="${t.navigation}"><a href="#definition">${t.concepts}</a><a href="#implementation">${t.implementation}</a></nav><div class="layout"><aside class="sidebar" id="sidebar" aria-label="${t.navigation}"><nav>${sidebar}</nav><a class="sidebar-bottom" href="../../source.html?lang=${lang}">${t.archive} ↗<br>${data.manifest.startedAt.slice(0,10)}</a></aside><button id="nav-backdrop" class="nav-backdrop" aria-label="${t.closeMenu}" hidden></button><main id="main" tabindex="-1"><article><div class="breadcrumb">${t.documentation}<span>/</span>${t.groups[page.group]}</div><header class="article-header"><div class="title-row"><h1>${esc(page.title[lang])}</h1><button class="copy-page" data-copy-page="../${page.id}.md">${t.copyPage}</button></div><p class="translation-note">${t.notice}</p></header>${sections}<section class="content-section references" id="references"><h2>${t.sections.references}</h2>${bibliography}</section></article><nav class="article-footer">${previous?`<a class="pager" href="../${previous.id}/"><small>← ${t.previous}</small>${esc(previous.title[lang])}</a>`:''}${next?`<a class="pager next" href="../${next.id}/"><small>${t.next} →</small>${esc(next.title[lang])}</a>`:''}</nav><footer class="footer-note"><a href="../${page.id}.md" download>${t.download}</a><p>${t.independent}</p></footer></main><aside class="outline" aria-label="${t.onPage}"><p>${t.onPage}</p><nav id="toc">${outline.map(h=>`<a href="#${h.id}" class="toc-depth-${h.depth}"${h.provider?` data-for-panel="${h.provider}"`:''}>${esc(h.title)}</a>`).join('')}</nav></aside></div>${dialogs(t)}${dataScript(t)}<noscript><p class="noscript">${t.noScript}</p></noscript></body></html>`;
  let markdown = `# ${page.title[lang]}\n\n${t.notice}\n\n`;
  const mdBlocks = items => items.map(b => {
    if (b.type === 'heading') return `<a id="${b.id}"></a>\n\n${'#'.repeat(b.level)} ${b.text[lang]}`;
    const content = b.type === 'code' ? `\`\`\`${b.language}\n${b.code}\n\`\`\`` :
      (b.type === 'item' ? (b.ordered ? '1. ' : '- ') : b.type === 'note' ? '> **'+t.note+'.** ' : '') + b.text[lang];
    return content + (['code','table'].includes(b.type) ? '\n\n' : ' ') + b.references.map(id => '[^'+id+']').join(' ');
  }).join('\n\n');
  for(const s of page.sections)markdown+=`<a id="${s.id}"></a>\n\n## ${t.sections[s.id]}\n\n`+(s.blocks?mdBlocks(s.blocks):s.panels.map(p=>`<a id="panel-${p.id}"></a>\n\n### ${p.label}\n\n${mdBlocks(p.blocks)}`).join('\n\n'))+'\n\n';
  markdown+=`## ${t.sections.references}\n\n`+used.map(id=>{const e=data.evidence[id],fence='`'.repeat(Math.max(3,...[...e.quote.matchAll(/`+/g)].map(m=>m[0].length+1)));return `[^${id}]: [${e.title} — ${e.section}](${e.url}). [${t.readOriginal}](../source.html?ref=${id}&lang=${lang}#excerpt-1), ${t.lines} ${e.lines.join('–')}.\n\n    ${fence}text\n${e.quote.split('\n').map(l=>'    '+l).join('\n')}\n    ${fence}`;}).join('\n\n')+'\n';
  return {html,markdown,index};
}

export async function build(output = 'dist') {
  const data = await loadContent(), destination=path.resolve(root,output);
  // Only named build directories inside this repository may be recursively replaced.
  assert.ok(['dist','.test-output'].includes(output) && path.dirname(destination)===path.resolve(root), 'Unsafe output directory');
  await fs.rm(destination,{recursive:true,force:true});
  const write=async(name,value)=>{const file=path.join(destination,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);};
  await fs.cp(path.join(root,'site'),path.join(destination,'assets'),{recursive:true});
  await fs.cp(path.join(root,'assets/fonts'),path.join(destination,'assets/fonts'),{recursive:true});
  for(const doc of data.manifest.documents.filter(d=>d.status==='ok')){await fs.mkdir(path.dirname(path.join(destination,doc.path)),{recursive:true});await fs.copyFile(path.join(root,doc.path),path.join(destination,doc.path));}
  await write('sources/manifest.json',await read('sources/manifest.json'));
  for(const lang of languages){
    const index=[];
    for(const page of data.pages){const compiled=renderPage(page,lang,data);await write(`${lang}/${page.id}/index.html`,compiled.html);await write(`${lang}/${page.id}.md`,compiled.markdown);index.push(...compiled.index);}
    await write(`assets/search-${lang}.json`,JSON.stringify(index));
  }
  await write('assets/aliases.json',JSON.stringify(data.aliases));
  await write('assets/references.json',JSON.stringify(Object.fromEntries(Object.entries(data.evidence).map(([id,{quote,...e}])=>[id,e]))));
  const t=data.ui.en;
  await write('source.html',head(t.archive,'en','',t.description)+`<body class="source-reader" data-source-reader data-root=""><header><div class="source-toolbar"><a class="brand" href="en/agents/">Docs</a><label><span data-i18n="chooseLanguage">${t.chooseLanguage}</span> <select id="language"><option value="en">English</option><option value="pt">Português</option></select></label><button data-theme-toggle aria-label="${t.light}">◐</button></div><h1 id="source-title" data-i18n="archive">${t.archive}</h1><p id="source-meta" data-i18n="sourceIntro">${t.sourceIntro}</p><div id="source-links"></div><input id="source-filter" type="search" aria-label="${t.sourceSearch}" placeholder="${t.sourceSearch}"></header><main id="source-content" tabindex="-1"><p data-i18n="loading">${t.loading}</p></main>${dataScript(data.ui)}<noscript><p>${t.sourceNoScript} <a href="sources/manifest.json">manifest.json</a></p></noscript></body></html>`);
  await write('index.html',head('Documentation','en','',t.description)+`<body data-redirect data-root=""><main class="entry"><a class="brand" href="en/agents/">Docs</a><p><a href="en/agents/">English</a> · <a href="pt/agents/">Português</a></p></main></body></html>`);
  await write('.nojekyll','');
  return data;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if (process.argv[2] === '--record-review') {
    assert.ok(process.argv[3]?.trim(), 'Supply a reviewer identity after completing the editorial review');
    const review = {reviewer:process.argv[3], scope:'English/Portuguese parity and source-backed content. This record identifies reviewed inputs; it is not an automated semantic assessment.', files:await reviewHashes()};
    await fs.writeFile(path.join(root,'content/review.json'),JSON.stringify(review,null,2)+'\n');
    console.log('Recorded input hashes. This command does not perform or certify an editorial review.');
  } else {
    assert.ok(!process.argv[2], 'Unknown build option');
    const data=await build();console.log(`Built ${data.pages.length*2} pages in two languages; ${Object.keys(data.evidence).length} exact references; 714 archived originals.`);
  }
}
