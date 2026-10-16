/** Pure functions shared by the build, browser and static tests. */
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function search(query, index) {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return index.filter(item => !item.anchor);
  return index.map(item => ({...item, score: words.reduce((n, word) => n +
    (normalize(item.title).includes(word) ? 6 : normalize(item.text).includes(word) ? 1 : -1000), 0)}))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
}

export function popupPosition(anchor, size, viewport) {
  const width = Math.min(size.width, viewport.width - 24), height = Math.min(size.height, viewport.height - 24);
  const top = anchor.bottom + 10 + height <= viewport.height - 12 ? anchor.bottom + 10 : anchor.top - 10 - height;
  return {left: Math.max(12, Math.min(anchor.left, viewport.width - width - 12)), top: Math.max(12, Math.min(top, viewport.height - height - 12))};
}

export function sourceLines(text, segments = []) {
  let offset = 0;
  const started = new Set();
  return text.split('\n').map((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const end = offset + line.length;
    let cursor = offset, html = '';
    segments.forEach(([start, stop], n) => {
      const lo = Math.max(offset, start), hi = Math.min(end, stop);
      if (lo >= hi) return;
      html += escapeHTML(text.slice(cursor, lo));
      html += `<mark${started.has(n) ? '' : ` id="excerpt-${n + 1}"`}>${escapeHTML(text.slice(lo, hi))}</mark>`;
      started.add(n); cursor = hi;
    });
    html += escapeHTML(text.slice(cursor, end)); offset += raw.length + 1;
    return `<span class="source-line" id="L${index + 1}"><a href="#L${index + 1}">${index + 1}</a><code>${html || ' '}</code></span>`;
  }).join('\n');
}

export function legacyRoute(hash, aliases, language = 'en') {
  const locale = language === 'pt' ? 'pt' : 'en';
  let route;
  try { route = decodeURIComponent(hash.replace(/^#\/?/, '')); } catch { return `${locale}/agents/`; }
  const [page, anchor = ''] = route.split('/');
  const mapped = Object.hasOwn(aliases.anchors, route) ? aliases.anchors[route] : null;
  const [id, target] = mapped ? mapped.split('/') : [Object.hasOwn(aliases.pages, page) ? aliases.pages[page] : 'agents', ''];
  return `${locale}/${id}/${target ? '#' + target : ''}`;
}
