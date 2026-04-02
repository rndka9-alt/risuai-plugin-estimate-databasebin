import type { AnalysisResult, SizeEntry, CharInfo } from './types';
import { fmt, pct, esc } from './utils';

// ── HTML 빌더 헬퍼 ────────────────────────────────────

function tr(cells: string[]): string { return '<tr>' + cells.join('') + '</tr>'; }
function td(v: string, cls?: string): string { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; }
function tdBar(v: string, w: string): string { return '<td class="n bv" style="--w:' + w + '%">' + v + '</td>'; }

function tbl(heads: [string, number?][], rows: string): string {
  const th = heads.map(h => '<th' + (h[1] ? ' class="n"' : '') + '>' + h[0] + '</th>').join('');
  return '<div class="tw"><table><thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function card(body: string, heading?: string, tag?: string): string {
  const t = tag || 'h2';
  return '<section class="c">' + (heading ? '<' + t + '>' + heading + '</' + t + '>' : '') + body + '</section>';
}

// 상위 N개 + 기타 행 생성 (root 키, 캐릭터 공용)
function topN<T extends SizeEntry & Record<string, any>>(
  items: T[],
  n: number,
  nameKey: keyof T,
  valKey: keyof T & ('raw' | 'gz'),
  minBytes?: number,
): string {
  const big = minBytes ? items.filter(x => (x[valKey] as number) >= minBytes) : items;
  const top = big.slice(0, n);
  const rest = items.length - top.length;
  let restSum = items.slice(top.length).reduce((s, x) => s + (x[valKey] as number), 0);
  if (minBytes) restSum += big.slice(n).reduce((s, x) => s + (x[valKey] as number), 0);
  const max = top.length > 0 ? (top[0][valKey] as number) : 1;

  let rows = top.map(x => {
    let name = String(x[nameKey]);
    if (name.length > 25) name = name.slice(0, 23) + '..';
    const val = x[valKey] as number;
    return tr([td(esc(name)), tdBar(fmt(val), (val / max * 100).toFixed(0))]);
  }).join('');
  if (rest > 0) rows += tr([td('기타 ' + rest + '개', 'mt'), td(fmt(restSum), 'n mt')]);
  return rows;
}

// 상세 보기용 행 (원본/gzip/압축률 포함)
function detailRows<T extends SizeEntry & Record<string, any>>(
  items: T[],
  nameKey: keyof T,
): string {
  return items.map(x => {
    let name = String(x[nameKey]);
    if (name.length > 25) name = name.slice(0, 23) + '..';
    return tr([td(esc(name)), td(fmt(x.raw), 'n'), td(fmt(x.gz), 'n'), td(x.gz <= x.raw ? pct(x.gz, x.raw) : '-', 'n')]);
  }).join('');
}

// 캐릭터별 breakdown 서브행 포함 상세 행
function charDetailRows(chars: CharInfo[]): string {
  const LABELS: [string, keyof CharInfo['breakdown']][] = [
    ['채팅', 'chats'], ['로어북', 'lorebook'], ['에셋', 'assets'], ['기타', 'other'],
  ];
  return chars.map((c, i) => {
    let name = c.name;
    if (name.length > 25) name = name.slice(0, 23) + '..';
    const parent = '<tr class="chr-row" data-ci="' + i + '">' +
      td('<span class="chr-arr">&#9656;</span> ' + esc(name)) +
      td(fmt(c.raw), 'n') + td(fmt(c.gz), 'n') +
      td(c.gz <= c.raw ? pct(c.gz, c.raw) : '-', 'n') +
      '</tr>';
    const sub = LABELS
      .filter(([, k]) => c.breakdown[k] > 0)
      .map(([label, k]) => '<tr class="chr-sub cl" data-cp="' + i + '">' +
        td('<span class="sub-indent">' + esc(label) + '</span>', 'mt') +
        td(fmt(c.breakdown[k]), 'n mt') +
        '<td class="n mt" colspan="2"></td></tr>')
      .join('');
    const chatLine = c.chatCount > 0
      ? '<tr class="chr-sub cl" data-cp="' + i + '">' +
        td('<span class="sub-indent sub-info">' + c.chatCount + '개 채팅 · ' + c.msgCount + '개 메시지</span>', 'mt') +
        '<td colspan="3"></td></tr>'
      : '';
    return parent + sub + chatLine;
  }).join('');
}

// ── 메인 렌더 ─────────────────────────────────────────

export function render(r: AnalysisResult, onRun: () => Promise<void>): void {
  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#8b5cf6'];
  const totalRaw = r.totals.raw;
  const savePct = totalRaw > 0 ? ((1 - r.totals.gz / totalRaw) * 100) : 0;

  // 100B 미만 블록 제거(Config 등), 블록명에서 부가 정보 제거
  const blocks = r.blocks
    .filter(b => b.raw >= 100)
    .map(b => {
      const name = b.name.replace(/ \(\d+개\)/, '').replace(/ \(접근 가능 부분\)/, '');
      return { name, raw: b.raw, gz: b.gz, pct: totalRaw > 0 ? (b.raw / totalRaw * 100) : 0 };
    });

  // 범례에 표시할 단위 통일 — 가장 큰 블록 기준
  const maxRaw = blocks.length > 0 ? blocks[0].raw : 0;
  let unit: string, divisor: number;
  if (maxRaw >= 1073741824) { unit = 'GB'; divisor = 1073741824; }
  else if (maxRaw >= 1048576) { unit = 'MB'; divisor = 1048576; }
  else if (maxRaw >= 1024) { unit = 'KB'; divisor = 1024; }
  else { unit = 'B'; divisor = 1; }
  const fmtU = (b: number) => (b / divisor).toFixed(2) + ' ' + unit;

  const stackSegs = blocks.map((b, i) => {
    const label = b.pct >= 5 ? (b.pct.toFixed(0) + '%') : '';
    return '<div class="seg" style="flex:' + Math.max(b.pct, 1).toFixed(1) + ';background:' + COLORS[i % COLORS.length] + '">' + label + '</div>';
  }).join('');

  const legend = blocks.map((b, i) => {
    return '<span class="leg"><span class="dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' + b.name + ' ' + fmtU(b.raw) + '</span>';
  }).join('');

  const envNote = r.info.saveMethod === 'account' ? '계정 동기화: Gzip 크기가 실제 전송 크기에 가깝습니다.'
    : r.info.platform === 'node' ? 'Node/Docker: 원본 크기가 실제 전송 크기에 가깝습니다.'
    : r.info.platform === 'tauri' ? 'Tauri: 로컬 파일 저장.' : '브라우저 로컬 저장.';

  const detH: [string, number?][] = [['블록'], ['원본', 1], ['Gzip', 1], ['압축률', 1]];

  document.getElementById('app')!.innerHTML =
    '<div class="hd"><div class="ha">' +
      '<button id="b-ref" class="btn">&#8635;</button>' +
      '<button id="b-cls" class="btn bc">&times;</button>' +
    '</div></div>' +

    '<div class="sum"><div class="sum-big">' + fmt(r.totals.gz) + '</div>' +
    '<div class="sum-label">' + savePct.toFixed(1) + '% 절감 (원본 ' + fmt(totalRaw) + ')</div></div>' +

    card('<div class="stack">' + stackSegs + '</div><div class="stack-leg">' + legend + '</div>') +

    (r.rootKeys.length > 0 ? card(tbl([['키'], ['크기', 1]], topN(r.rootKeys, 5, 'key', 'raw', 1024)), 'Root 상위') : '') +
    (r.chars.length > 0 ? card(tbl([['이름'], ['크기', 1]], topN(r.chars, 5, 'name', 'raw')), '캐릭터 상위') : '') +

    '<h2 id="dt" class="tg det-tg">상세 &#9656;</h2>' +
    '<div id="dd" class="cl">' +
      card(tbl(detH, detailRows(r.blocks, 'name')), '블록', 'h3') +
      card(tbl([['키'], ['원본', 1], ['Gzip', 1], ['압축률', 1]], detailRows(r.rootKeys, 'key')), 'Root 키 전체', 'h3') +
      card(tbl([['이름'], ['원본', 1], ['Gzip', 1], ['압축률', 1]], charDetailRows(r.chars.slice(0, 50))) +
        (r.chars.length > 50 ? '<p class="more">...외 ' + (r.chars.length - 50) + '개</p>' : ''), '캐릭터 전체', 'h3') +
    '</div>' +

    '<p class="fn">' + envNote + ' 화이트리스트 외 데이터는 추산에 미포함.</p>';

  document.getElementById('b-cls')!.addEventListener('click', () => { risuai.hideContainer(); });
  document.getElementById('b-ref')!.addEventListener('click', () => { onRun(); });
  document.getElementById('dt')!.addEventListener('click', () => {
    const d = document.getElementById('dd')!;
    const t = document.getElementById('dt')!;
    t.innerHTML = '상세 ' + (d.classList.toggle('cl') ? '&#9656;' : '&#9662;');
  });

  // 캐릭터 행 클릭 → breakdown 서브행 토글
  for (const row of document.querySelectorAll('.chr-row')) {
    row.addEventListener('click', () => {
      const ci = row.getAttribute('data-ci');
      const arr = row.querySelector('.chr-arr');
      const subs = document.querySelectorAll('.chr-sub[data-cp="' + ci + '"]');
      const opening = subs.length > 0 && subs[0].classList.contains('cl');
      for (const sub of subs) {
        if (opening) sub.classList.remove('cl');
        else sub.classList.add('cl');
      }
      if (arr) arr.innerHTML = opening ? '&#9662;' : '&#9656;';
    });
  }
}
