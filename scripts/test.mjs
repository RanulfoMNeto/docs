/** Static verification only: no browser, server, external network or agent commands. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {build, root, blocks, sha, inline} from './build.mjs';
import {exactEvidence} from './evidence.mjs';
import {escapeHTML, sourceLines, legacyRoute, search, popupPosition} from '../site/lib.js';

const read = file => fs.readFile(path.join(root,file),'utf8');
const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const decode = text => text.replace(/&(amp|lt|gt|quot|#39|#13);/g,(_,key) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'",'#13':'\r'}[key]));
const codeTokens = text => [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]).sort();
const linkTargets = text => [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).sort();

test('evidence preserves original bytes after UTF-8 decoding and rejects invalid selections', () => {
  const text = '# Test\r\nAlpha 😀 <script>\r\nBeta\r\n## Next\r\nEnd';
  const start = text.indexOf('Alpha'), end = text.indexOf('Beta');
  const ref = {heading:'# Test',lines:[2,3],segments:[[start,end],[end,end+4]]};
  assert.equal(exactEvidence(text,ref).quote,'Alpha 😀 <script>\r\nBeta');
  const omitted = {...ref, segments:[[start,start+5],[end,end+4]]};
  assert.equal(exactEvidence(text,omitted).quote,'Alpha\n[...]\nBeta');
  for (const segments of [[],[[start-1,end]],[[end,start]],[[start,end],[start,end]],[[start,text.length+1]],[[start,start+7]]]) {
    assert.throws(() => exactEvidence(text,{...ref,segments}));
  }
  assert.throws(() => exactEvidence(text,{...ref,heading:'# Missing'}));
  assert.throws(() => exactEvidence(text,{...ref,lines:[0,3]}));
  assert.throws(() => exactEvidence(text,{...ref,lines:[2,99]}));
  const rendered = sourceLines(text,ref.segments);
  assert.ok(!rendered.includes('<script>'));
  assert.match(rendered,/<mark id="excerpt-1">Alpha 😀 &lt;script&gt;<\/mark>/);
  assert.match(rendered,/<mark id="excerpt-2">Beta<\/mark>/);
});

test('navigation, search and popup geometry handle edge cases', () => {
  const aliases = {pages:{old:'agents'},anchors:{'old/old-heading':'agents/operation'}};
  assert.equal(legacyRoute('#/old/old-heading',aliases,'pt'),'pt/agents/#operation');
  assert.equal(legacyRoute('#/old/deleted',aliases),'en/agents/');
  for (const value of ['#/%ZZ','#/constructor','#/unknown']) assert.equal(legacyRoute(value,aliases),'en/agents/');
  const index = [{page:'a',anchor:'one',title:'Permissões',text:'Read and execute'},{page:'b',anchor:'',title:'Home',text:'Overview'}];
  assert.equal(search('permissoes execute',index)[0].page,'a');
  assert.equal(search('permissoes absent',index).length,0);
  assert.deepEqual(search('',index),[index[1]]);
  assert.deepEqual(popupPosition({left:900,top:700,bottom:720},{width:520,height:350},{width:1024,height:768}),{left:492,top:340});
  assert.deepEqual(popupPosition({left:0,top:0,bottom:20},{width:520,height:800},{width:320,height:400}),{left:12,top:12});
  assert.throws(() => inline('[unsafe](javascript:alert)','en'));
  assert.equal(inline('<img src=x>','en'),'&lt;img src=x&gt;');
});

test('complete bilingual publication, exact evidence, old routes and reproducibility', async t => {
  const data = await build();
  assert.deepEqual(Object.keys(data.ui.en).sort(),Object.keys(data.ui.pt).sort());
  assert.equal(data.pages.length,21);
  assert.equal(Object.keys(data.evidence).length,487);
  assert.equal(data.pages.flatMap(blocks).filter(b => b.type !== 'heading').length,490);
  assert.deepEqual([...new Set(data.pages.map(p => p.group))],Object.keys(data.ui.en.groups));
  const htmlByPath = new Map(), anchors = new Map();
  for (const lang of ['en','pt']) for (const page of data.pages) {
    const file = `${lang}/${page.id}/index.html`, html = await read('dist/'+file);
    htmlByPath.set(file,html); anchors.set(file,new Set(ids(html)));
    assert.equal(ids(html).length,anchors.get(file).size,`Duplicate anchors: ${file}`);
    assert.ok(html.startsWith(`<!doctype html><html lang="${data.ui[lang].htmlLanguage}"`));
    assert.equal((html.match(/class="provider-panel"/g)||[]).length,3);
    assert.ok(!html.match(/class="provider-panel"[^>]*hidden/),'Content must remain available without JavaScript');
    const md = await read(`dist/${lang}/${page.id}.md`);
    const pageRefs = new Set();
    for (const block of blocks(page)) {
      if (block.type === 'heading') { assert.ok(anchors.get(file).has(block.id)); assert.ok(md.includes(`id="${block.id}"`)); }
      else for (const id of block.references) pageRefs.add(id);
      if (block.type === 'code') {
        assert.ok(html.includes(`<code>${escapeHTML(block.code)}</code>`));
        assert.ok(md.includes(block.code));
      } else {
        assert.deepEqual(codeTokens(block.text.en),codeTokens(block.text.pt),`Translated code identifier: ${page.id} ${block.references}`);
        assert.deepEqual(linkTargets(block.text.en),linkTargets(block.text.pt),`Different translated links: ${page.id}`);
      }
    }
    for (const id of pageRefs) {
      const evidence = data.evidence[id];
      const excerpt = html.match(new RegExp(`<details id="ref-${id}"[\\s\\S]*?<pre lang="en">([\\s\\S]*?)</pre>`));
      assert.ok(excerpt,`Missing original: ${file} ${id}`);
      assert.equal(decode(excerpt[1]),evidence.quote,`Changed original: ${id}`);
      assert.ok(md.includes(evidence.quote.split('\n').map(l=>'    '+l).join('\n')));
      const original = await read(evidence.path), highlighted = sourceLines(original,evidence.segments);
      evidence.segments.forEach((_,i) => assert.ok(highlighted.includes(`id="excerpt-${i+1}"`),`Missing highlight: ${id}`));
      for (const citation of evidence.citations.filter(c => c.page === page.id)) assert.ok(anchors.get(file).has(citation.anchor));
    }
  }
  await t.test('every local HTML link resolves under a GitHub Pages project path',async () => {
    for (const [file,html] of htmlByPath) for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = decode(match[1]);
      if (/^(https:|data:)/.test(target)) continue;
      const url = new URL(target,`https://example.test/repository/${file.replace(/index\.html$/,'')}`);
      assert.ok(url.pathname.startsWith('/repository/'),`Escapes project path: ${target}`);
      let local = decodeURIComponent(url.pathname.slice('/repository/'.length));
      if (local.endsWith('/')) local += 'index.html';
      await fs.access(path.join(root,'dist',local));
      if (local === 'source.html') {
        const ref = url.searchParams.get('ref');
        if (ref) assert.ok(data.evidence[ref]);
      } else if (url.hash) assert.ok(anchors.get(local)?.has(decodeURIComponent(url.hash.slice(1))),`Missing anchor: ${file} → ${target}`);
    }
  });
  await t.test('locale structure, legacy aliases and search destinations agree',async () => {
    for (const page of data.pages) assert.deepEqual(anchors.get(`en/${page.id}/index.html`),anchors.get(`pt/${page.id}/index.html`));
    for (const [old,target] of Object.entries(data.aliases.anchors)) {
      const [page,anchor] = target.split('/');
      assert.ok(anchors.has(`en/${page}/index.html`),`Unknown alias page: ${old}`);
      if (anchor) assert.ok(anchors.get(`en/${page}/index.html`).has(anchor),`Unknown alias anchor: ${old} → ${target}`);
      assert.equal(legacyRoute('#/'+old,data.aliases),`en/${page}/${anchor?'#'+anchor:''}`);
    }
    for (const id of Object.values(data.aliases.pages)) assert.ok(anchors.has(`en/${id}/index.html`));
    for (const lang of ['en','pt']) {
      const index = JSON.parse(await read(`dist/assets/search-${lang}.json`));
      for (const entry of index) assert.ok(anchors.get(`${lang}/${entry.page}/index.html`)?.has(entry.anchor) || !entry.anchor);
      for (const page of data.pages) {
        assert.ok(search(page.title[lang],index).some(result => result.page === page.id));
        for (const block of blocks(page).filter(b => b.type === 'heading')) assert.ok(index.some(result => result.page === page.id && result.anchor === block.id));
      }
    }
  });
  await t.test('local assets, shared fonts and theme tokens remain valid',async () => {
    const css = await read('site/style.css');
    assert.ok(css.includes('--bg:#09090B')); assert.ok(css.includes('--bg:#FDFDF7'));
    assert.match(css,/\.brand\{font:400 27px\/1 var\(--serif\)/);
    for (const match of css.matchAll(/url\("([^"\)]+)"\)/g)) await fs.access(path.join(root,'dist/assets',match[1]));
    for (const font of JSON.parse(await read('assets/fonts/provenance.json'))) assert.equal(sha(await fs.readFile(path.join(root,font.path))),font.sha256);
    for (const file of ['site/app.js','site/lib.js']) {
      const check = spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true});
      assert.equal(check.status,0,check.stderr);
    }
  });
  await t.test('a second offline generation is byte-for-byte identical',async () => {
    await build('.test-output');
    const files = async dir => (await fs.readdir(path.join(root,dir),{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>path.relative(path.join(root,dir),path.join(e.parentPath,e.name))).sort();
    const first = await files('dist'), second = await files('.test-output');
    assert.deepEqual(first,second);
    for (const file of first) assert.equal(sha(await fs.readFile(path.join(root,'dist',file))),sha(await fs.readFile(path.join(root,'.test-output',file))),`Non-reproducible: ${file}`);
    const temporary = path.resolve(root,'.test-output');
    assert.equal(path.dirname(temporary),path.resolve(root));
    await fs.rm(temporary,{recursive:true,force:true});
  });
});
