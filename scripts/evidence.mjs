/** Pure editorial helpers; no network, tools or application startup. */
export function sourceHeadings(text) {
  const lines = text.split(/\r?\n/), headings = [];
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !line.slice(delimiter[0].length).trim()) fence = null;
      continue;
    }
    if (!fence && /^#{1,6} /.test(line)) headings.push({line, index, level: line.match(/^#+/)[0].length});
    const html=!fence&&line.match(/^<h([1-6]) id="([^"]+)">/);
    if(html){
      const close=lines.slice(index,index+4).join(' ').match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/);
      if(close)headings.push({line:'#'.repeat(Number(html[1]))+' '+close[1].trim(),index,level:Number(html[1]),anchor:html[2]});
    }
  }
  return headings;
}

export function evidenceRange(text, reference) {
  const lines=text.split(/\r?\n/),headings=sourceHeadings(text);
  const matches = headings.filter(h => h.line === reference.heading);
  if (matches.length !== 1) throw new Error(`Expected one evidence heading: ${reference.heading}`);
  const heading = matches[0];
  const sectionFrom = heading.index + 1;
  const sectionTo = headings.find(h => h.index > heading.index && h.level <= heading.level)?.index ?? lines.length;
  const range = reference.lines === undefined ? [sectionFrom, sectionTo] : reference.lines;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < sectionFrom || range[1] > sectionTo || range[0] > range[1]) {
    throw new Error(`Evidence lines must be an inclusive range within ${sectionFrom}–${sectionTo}: ${reference.heading}`);
  }
  return {from: range[0], to: range[1], sectionFrom, sectionTo, level: heading.level};
}

// Offsets are zero-based JavaScript UTF-16 string positions, end exclusive.
// Never normalize the decoded source: CRLF, indentation and Unicode are evidence.
export function exactEvidence(text, reference) {
  const range = evidenceRange(text, reference);
  const rows = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0]);
  const lo = rows[range.from - 1]?.index ?? text.length;
  const hi = range.to < rows.length ? rows[range.to].index : text.length;
  if (!Array.isArray(reference.segments) || !reference.segments.length) throw Error('Missing exact evidence segments');
  let previous = lo;
  const segments = reference.segments.map(pair => {
    if (!Array.isArray(pair) || pair.length !== 2) throw Error('Invalid evidence segment');
    const [start, end] = pair;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < lo || end > hi || start >= end || start < previous) throw Error('Evidence segments must be ordered, non-overlapping and inside selected lines');
    for (const p of [start, end]) if (p > 0 && /[\uD800-\uDBFF]/.test(text[p-1]) && /[\uDC00-\uDFFF]/.test(text[p] || '')) throw Error('Evidence boundary splits a Unicode character');
    previous = end;
    return {start, end, text:text.slice(start, end)};
  });
  const quote=segments.map((s,i)=>(i&&segments[i-1].end<s.start?'\n[...]\n':'')+s.text).join('');
  return {...range, segments, quote};
}
