import {escapeHTML as esc, search, normalize, popupPosition, sourceLines, legacyRoute} from './lib.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const storage = {
  get(key) { try { return localStorage.getItem('docs:' + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem('docs:' + key, value); } catch {} }
};
const prefix = document.body.dataset.root;
async function request(url, type = 'json') {
  const response = await fetch(url);
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response[type]();
}

if (document.body.hasAttribute('data-redirect')) {
  const language = storage.get('language') === 'pt' ? 'pt' : 'en';
  try { location.replace(legacyRoute(location.hash, await request('assets/aliases.json'), language)); }
  catch { location.replace(`${language}/agents/`); }
} else {
  const sourceReader = document.body.hasAttribute('data-source-reader');
  const query = new URLSearchParams(location.search);
  const language = sourceReader ? (query.get('lang') === 'pt' ? 'pt' : 'en') : document.body.dataset.language;
  const messages = JSON.parse($('#ui-data').textContent);
  const t = sourceReader ? messages[language] : messages;
  storage.set('language', language);
  const themeLabel = () => $$('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? t.light : t.dark);
  });
  themeLabel();
  $$('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme; storage.set('theme', theme); themeLabel();
  }));
  $('#language').addEventListener('change', event => {
    if (sourceReader) {
      query.set('lang', event.target.value);
      location.assign('source.html?' + query + location.hash);
    } else location.assign(event.target.value + location.hash);
  });
  if (sourceReader) await readSource(); else enhanceArticle();

  async function readSource() {
    document.documentElement.lang = t.htmlLanguage;
    document.title = t.archive + ' — Docs';
    $('#language').value = language;
    $('.brand').href = `${language}/agents/`;
    $$('[data-i18n]').forEach(node => { node.textContent = t[node.dataset.i18n]; });
    const filter = $('#source-filter'), content = $('#source-content');
    filter.placeholder = t.sourceSearch; filter.setAttribute('aria-label', t.sourceSearch);
    try {
      const manifest = await request('sources/manifest.json');
      const documents = manifest.documents.filter(doc => doc.status === 'ok');
      const referenceId = query.get('ref');
      const references = referenceId ? await request('assets/references.json') : {};
      const ref = Object.hasOwn(references, referenceId) ? references[referenceId] : null;
      if (referenceId && !ref) throw Error('Unknown reference');
      const documentPath = ref?.path || query.get('document');
      if (!documentPath) {
        const list = () => {
          const words = normalize(filter.value).split(/\s+/).filter(Boolean);
          content.innerHTML = '<ul class="source-catalog">' + documents.filter(doc => words.every(word => normalize(doc.provider + ' ' + doc.title + ' ' + doc.path).includes(word)))
            .map(doc => `<li><a href="source.html?document=${encodeURIComponent(doc.path)}&amp;lang=${language}"><span>${esc(doc.title)}</span><small>${esc(doc.provider)} · ${esc(doc.path.replace('sources/raw/',''))}</small></a></li>`).join('') + '</ul>';
        };
        filter.addEventListener('input', list); list(); return;
      }
      const doc = documents.find(item => item.path === documentPath);
      if (!doc || !doc.path.startsWith('sources/raw/') || doc.path.includes('..')) throw Error('Unknown document');
      const text = await request(doc.path, 'text');
      filter.hidden = true;
      $('#source-title').textContent = ref?.title || doc.title;
      document.title = $('#source-title').textContent + ' — Docs';
      $('#source-meta').textContent = `${doc.provider} · ${t.snapshot} ${manifest.startedAt.slice(0,10)}${ref ? ` · ${ref.section} · ${t.lines} ${ref.lines.join('–')}` : ''}`;
      const url = new URL(ref?.url || doc.finalUrl);
      if (url.protocol !== 'https:') throw Error('Invalid official URL');
      $('#source-links').innerHTML = `<a href="${esc(doc.path)}" download>${t.raw}</a> · <a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${t.official} ↗</a> · <a href="source.html?lang=${language}">${t.archive}</a>`;
      if (ref) $('#source-links').innerHTML += '<p>' + ref.citations.map((citation,i) => `<a href="${language}/${citation.page}/#${citation.anchor}">${t.back} ${i+1}</a>`).join(' · ') + '</p>';
      content.innerHTML = `<pre>${sourceLines(text, ref?.segments)}</pre>`;
      const target = document.getElementById(location.hash.slice(1)) || (ref && $('#excerpt-1'));
      target?.scrollIntoView({block:'center'});
    } catch {
      content.textContent = t.sourceError;
      const link = document.createElement('a'); link.href = 'sources/manifest.json'; link.textContent = 'manifest.json';
      content.append(document.createTextNode(' '), link);
    }
  }

  function enhanceArticle() {
    const tabs = $$('.provider-tab'), panels = $$('.provider-panel');
    let provider = ['codex','claude','cursor'].includes(storage.get('provider')) ? storage.get('provider') : 'codex';
    function selectProvider(id, updateAddress = false) {
      provider = id; storage.set('provider', id);
      if (updateAddress && location.hash) {
        const destination = document.getElementById(location.hash.slice(1))?.closest('[data-panel]');
        if (destination && destination.dataset.panel !== id) history.replaceState(null,'','#panel-'+id);
      }
      tabs.forEach(tab => { const active = tab.dataset.provider === id; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
      panels.forEach(panel => { panel.hidden = panel.dataset.panel !== id; });
      $$('[data-for-panel]').forEach(link => { link.hidden = link.dataset.forPanel !== id; });
    }
    function followAnchor() {
      let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target) return;
      const panel = target.closest('[data-panel]');
      if (panel) selectProvider(panel.dataset.panel);
      if (target.matches('details')) target.open = true;
      requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
    }
    $('.provider-tabs').hidden = false; document.body.classList.add('tabs-enabled');
    panels.forEach(panel => { panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby','tab-'+panel.dataset.panel); });
    selectProvider(provider); followAnchor();
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectProvider(tab.dataset.provider,true));
      tab.addEventListener('keydown', event => {
        const next = {ArrowRight:(index+1)%tabs.length, ArrowLeft:(index+tabs.length-1)%tabs.length, Home:0, End:tabs.length-1}[event.key];
        if (next !== undefined) { event.preventDefault(); tabs[next].focus(); selectProvider(tabs[next].dataset.provider,true); }
      });
    });
    window.addEventListener('hashchange', followAnchor);

    const menu = $('#menu-toggle'), sidebar = $('#sidebar'), backdrop = $('#nav-backdrop');
    const mobile = matchMedia('(max-width:1023px)');
    function setMenu(open) {
      sidebar.classList.toggle('open', open); sidebar.inert = mobile.matches && !open;
      backdrop.hidden = !open; menu.setAttribute('aria-expanded', String(open));
    }
    setMenu(false); mobile.addEventListener('change', () => setMenu(false));
    menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
    backdrop.addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !backdrop.hidden) { setMenu(false); menu.focus(); } });

    let toastTimer;
    async function copy(text) {
      const toast = $('#toast');
      try { await navigator.clipboard.writeText(text); toast.textContent = t.copied; }
      catch { toast.textContent = t.copyError; }
      toast.classList.add('visible'); clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
    }
    $$('[data-copy]').forEach(button => button.addEventListener('click', () => copy(button.closest('.code-block').querySelector('code').textContent)));
    $('[data-copy-page]').addEventListener('click', async event => {
      try { await copy(await request(event.currentTarget.dataset.copyPage, 'text')); }
      catch { $('#toast').textContent = t.copyError; $('#toast').classList.add('visible'); }
    });

    const dialog = $('#search-dialog'), input = $('#search-input'), results = $('#search-results');
    let index, selected = -1, searchVersion = 0;
    async function updateSearch() {
      const version = ++searchVersion; results.textContent = t.loading;
      try {
        index ||= await request(`${prefix}assets/search-${language}.json`);
        if (version !== searchVersion) return;
        const found = search(input.value, index);
        results.innerHTML = found.length ? found.map(item => `<a class="search-item" href="${prefix}${language}/${item.page}/${item.anchor ? '#'+item.anchor : ''}"><strong>${esc(item.title)}</strong><small>${esc(item.text.slice(0,180))}</small></a>`).join('') : `<p class="search-empty">${t.noResults}</p>`;
        selected = -1;
      } catch { if (version === searchVersion) results.textContent = t.searchError; }
    }
    function openSearch() { if (!dialog.open) dialog.showModal(); input.focus(); updateSearch(); }
    $('#search-open').addEventListener('click', openSearch);
    $('#search-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    input.addEventListener('input', updateSearch);
    results.addEventListener('click', event => { if (event.target.closest('a')) dialog.close(); });
    input.addEventListener('keydown', event => {
      const links = [...results.querySelectorAll('a')];
      if (['ArrowDown','ArrowUp'].includes(event.key) && links.length) {
        event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((link,i) => link.classList.toggle('highlighted', i === selected)); links[selected].scrollIntoView({block:'nearest'});
      } else if (event.key === 'Enter' && links.length) { event.preventDefault(); links[Math.max(0,selected)].click(); }
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    });

    const popup = $('#evidence-popup');
    let trigger, closeTimer, showTimer, restoringFocus = false;
    function hideEvidence(restoreFocus = false) {
      clearTimeout(showTimer); clearTimeout(closeTimer); popup.hidden = true;
      $$('.evidence-active').forEach(node => node.classList.remove('evidence-active'));
      $$('.citation-link[aria-expanded="true"]').forEach(node => node.setAttribute('aria-expanded','false'));
      if (restoreFocus) {
        restoringFocus = true;
        (trigger?.matches('a') ? trigger : trigger?.querySelector('.citation-link'))?.focus();
        restoringFocus = false;
      }
    }
    function positionEvidence() {
      if (popup.hidden || !trigger) return;
      const point = popupPosition(trigger.getBoundingClientRect(), popup.getBoundingClientRect(), {width:innerWidth,height:innerHeight});
      popup.style.left = point.left + 'px'; popup.style.top = point.top + 'px';
    }
    function showEvidence(node) {
      clearTimeout(showTimer); clearTimeout(closeTimer);
      const original = document.getElementById('ref-'+node.dataset.source);
      if (!original) return;
      hideEvidence(); trigger = node;
      $('#evidence-title').textContent = original.querySelector('summary span').textContent;
      $('#evidence-meta').textContent = original.querySelector('summary small').textContent;
      $('#evidence-quote').textContent = original.querySelector('pre').textContent;
      $('#evidence-local').href = original.querySelector('.original-local').href;
      $('#evidence-official').href = original.querySelector('.original-official').href;
      node.classList.add('evidence-active');
      (node.matches('.citation-link') ? node : node.querySelector('.citation-link'))?.setAttribute('aria-expanded','true');
      popup.hidden = false; positionEvidence();
    }
    const scheduleHide = () => {
      clearTimeout(showTimer); clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (!popup.matches(':hover') && !popup.contains(document.activeElement) && !trigger?.matches(':hover') && !trigger?.contains(document.activeElement)) hideEvidence(); },180);
    };
    $$('[data-source]').forEach(node => {
      node.addEventListener('pointerenter', event => {
        if (event.pointerType === 'mouse') { clearTimeout(closeTimer); clearTimeout(showTimer); showTimer = setTimeout(() => showEvidence(node),250); }
      });
      node.addEventListener('pointerleave', scheduleHide);
      if (node.matches('a')) node.addEventListener('focus', () => { if (!restoringFocus) showEvidence(node); });
      node.addEventListener('focusout', scheduleHide);
      node.addEventListener('click', event => {
        if (node.matches('a')) { event.preventDefault(); event.stopPropagation(); showEvidence(node); $('#evidence-local').focus(); return; }
        if (event.target.closest('a,button,input,summary') || window.getSelection()?.toString()) return;
        const link = document.getElementById('ref-'+node.dataset.source)?.querySelector('.original-local');
        if (link) window.open(link.href,'_blank','noopener,noreferrer');
      });
    });
    popup.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    popup.addEventListener('pointerleave', scheduleHide); popup.addEventListener('focusout', scheduleHide);
    $('[data-evidence-close]').addEventListener('click', () => hideEvidence(true));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); hideEvidence(true); } });
    document.addEventListener('pointerdown', event => { if (!popup.hidden && !popup.contains(event.target) && !event.target.closest('[data-source]')) hideEvidence(); });
    window.addEventListener('resize', positionEvidence); window.addEventListener('scroll', positionEvidence, {passive:true});
  }
}
