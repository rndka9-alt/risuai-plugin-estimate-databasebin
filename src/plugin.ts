// esbuild IIFE는 top-level await를 지원하지 않으므로,
// 진입점만 async IIFE로 감싸서 해결 (하단 참조)

// ── 내부 타입 ──────────────────────────────────────────

/** ColorScheme에서 테마 적용에 필요한 필드만 추린 서브셋 */
type ThemeColors = Pick<
  ColorScheme,
  'bgcolor' | 'darkbg' | 'borderc' | 'selected' | 'draculared' |
  'textcolor' | 'textcolor2' | 'darkBorderc' | 'darkbutton'
>;

interface SizeEntry {
  raw: number;
  gz: number;
}

interface BlockInfo extends SizeEntry {
  name: string;
}

interface RootKeyInfo extends SizeEntry {
  key: string;
}

interface CharInfo extends SizeEntry {
  name: string;
  chatCount: number;
  msgCount: number;
}

interface RuntimeInfo {
  apiVersion: string;
  platform: string;
  saveMethod: string;
}

interface AnalysisResult {
  info: RuntimeInfo;
  blocks: BlockInfo[];
  rootKeys: RootKeyInfo[];
  chars: CharInfo[];
  totals: SizeEntry;
}

// ── 정적 데이터 ────────────────────────────────────────

// getDatabase()가 반환하는 화이트리스트 키 (characters, modules 제외 — 별도 블록)
// selectedPersona, characterOrder는 런타임에 접근 가능하나 d.ts에 누락되어 있음
const ROOT_KEYS: string[] = [
  'enabledModules', 'moduleIntergration', 'pluginV2', 'personas', 'plugins',
  'pluginCustomStorage', 'temperature', 'askRemoval', 'maxContext', 'maxResponse',
  'frequencyPenalty', 'PresensePenalty', 'theme', 'textTheme', 'lineHeight',
  'seperateModelsForAxModels', 'seperateModels', 'customCSS', 'guiHTML',
  'colorSchemeName', 'selectedPersona', 'characterOrder',
];

// getColorScheme() 미구현 버전 대비 fallback — colorscheme.ts의 프리셋 복사
const PRESET_SCHEMES: Record<string, ThemeColors> = {
  'default':       { bgcolor:'#282a36', darkbg:'#21222c', borderc:'#6272a4', selected:'#44475a', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#64748b', darkBorderc:'#4b5563', darkbutton:'#374151' },
  'dark':          { bgcolor:'#1a1a1a', darkbg:'#141414', borderc:'#525252', selected:'#3d3d3d', draculared:'#ff5555', textcolor:'#f5f5f5', textcolor2:'#a3a3a3', darkBorderc:'#404040', darkbutton:'#2e2e2e' },
  'light':         { bgcolor:'#ffffff', darkbg:'#f0f0f0', borderc:'#0f172a', selected:'#e0e0e0', draculared:'#ff5555', textcolor:'#0f172a', textcolor2:'#64748b', darkBorderc:'#d1d5db', darkbutton:'#e5e7eb' },
  'cherry':        { bgcolor:'#450a0a', darkbg:'#7f1d1d', borderc:'#ea580c', selected:'#d97706', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#fca5a5', darkBorderc:'#92400e', darkbutton:'#b45309' },
  'galaxy':        { bgcolor:'#0f172a', darkbg:'#1f2a48', borderc:'#8be9fd', selected:'#457b9d', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#8be9fd', darkBorderc:'#457b9d', darkbutton:'#1f2a48' },
  'nature':        { bgcolor:'#1b4332', darkbg:'#2d6a4f', borderc:'#a8dadc', selected:'#4d908e', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#4d908e', darkBorderc:'#457b9d', darkbutton:'#2d6a4f' },
  'realblack':     { bgcolor:'#000000', darkbg:'#000000', borderc:'#6272a4', selected:'#44475a', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#64748b', darkBorderc:'#4b5563', darkbutton:'#374151' },
  'monokai-light': { bgcolor:'#f8f8f2', darkbg:'#e8e8e3', borderc:'#75715e', selected:'#d8d8d0', draculared:'#f92672', textcolor:'#272822', textcolor2:'#75715e', darkBorderc:'#c0c0b8', darkbutton:'#d0d0c8' },
  'monokai-black': { bgcolor:'#272822', darkbg:'#1e1f1a', borderc:'#75715e', selected:'#3e3d32', draculared:'#f92672', textcolor:'#f8f8f2', textcolor2:'#a6a68a', darkBorderc:'#3e3d32', darkbutton:'#3e3d32' },
  'lite':          { bgcolor:'#1f2937', darkbg:'#1C2533', borderc:'#475569', selected:'#475569', draculared:'#ff5555', textcolor:'#f8f8f2', textcolor2:'#64748b', darkBorderc:'#030712', darkbutton:'#374151' },
};

// ── 유틸 함수 ──────────────────────────────────────────

function fmt(b: number): string {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
}

// 압축률: 양수 = 줄어듦, 음수 = 오히려 커짐 (gzip 헤더 오버헤드)
function pct(gz: number, raw: number): string {
  return raw === 0 ? '-' : ((1 - gz / raw) * 100).toFixed(1) + '%';
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// RisuSave 블록 헤더 오버헤드: type(1) + compression(1) + nameLen(1) + name + dataLen(4)
function blockHead(name: string): number {
  return 7 + new TextEncoder().encode(name).byteLength;
}

// gzip 압축 크기 계산 (CompressionStream 미지원 시 60% 추정)
async function gzip(data: string | ArrayBuffer): Promise<number> {
  const buf =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (buf.byteLength === 0) return 0;

  if (typeof CompressionStream === 'undefined') {
    return Math.ceil(buf.byteLength * 0.6);
  }

  try {
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    return total;
  } catch {
    return Math.ceil(buf.byteLength * 0.6);
  }
}

// ── 분석 ───────────────────────────────────────────────

async function analyze(
  db: DatabaseSubset,
  info: RuntimeInfo,
  progress: (msg: string) => void,
): Promise<AnalysisResult> {

  // RISUSAVE\0 파일 헤더
  const HEADER_SIZE = 9;
  const result: AnalysisResult = {
    info,
    blocks: [],
    rootKeys: [],
    chars: [],
    totals: { raw: HEADER_SIZE, gz: HEADER_SIZE },
  };

  // Config 블록 — 버전 메타데이터
  const cfgJson = JSON.stringify({ version: 1 });
  const cfgSize = new TextEncoder().encode(cfgJson).byteLength + blockHead('config');
  result.blocks.push({ name: 'Config', raw: cfgSize, gz: cfgSize });
  result.totals.raw += cfgSize;
  result.totals.gz += cfgSize;

  // Root 블록 — 화이트리스트 키만 접근 가능 (실제로는 DB 전체 설정 포함)
  progress('Root 블록 분석 중...');
  const rootObj: Record<string, unknown> = {};
  for (const key of ROOT_KEYS) {
    const val = (db as Record<string, unknown>)[key];
    if (val === undefined || val === null) continue;
    rootObj[key] = val;

    const json = JSON.stringify(val);
    const raw = new TextEncoder().encode(json).byteLength;
    // 5B 미만은 키별 분석에서 제외 (노이즈)
    if (raw < 5) continue;
    const gz = await gzip(json);
    result.rootKeys.push({ key, raw, gz });
  }
  result.rootKeys.sort((a, b) => b.raw - a.raw);

  const rootJson = JSON.stringify(rootObj);
  const rootRaw = new TextEncoder().encode(rootJson).byteLength + blockHead('root');
  const rootGz = (await gzip(rootJson)) + blockHead('root');
  result.blocks.push({ name: 'Root (접근 가능 부분)', raw: rootRaw, gz: rootGz });
  result.totals.raw += rootRaw;
  result.totals.gz += rootGz;

  // Character 블록 — RisuSave에서 캐릭터별로 개별 블록 생성
  let charRaw = 0;
  let charGz = 0;
  const characters: any[] = Array.isArray(db.characters) ? db.characters : [];

  for (let i = 0; i < characters.length; i++) {
    progress('캐릭터 분석 중... (' + (i + 1) + '/' + characters.length + ')');
    try {
      const c = characters[i];
      const json = JSON.stringify(c);
      const raw = new TextEncoder().encode(json).byteLength;
      const gz = await gzip(json);
      // chaId가 블록 이름으로 사용됨
      const id: string = c.chaId || 'char_' + i;
      const oh = blockHead(id);

      let chatCount = 0;
      let msgCount = 0;
      if (Array.isArray(c.chats)) {
        chatCount = c.chats.length;
        for (const chat of c.chats) {
          if (Array.isArray(chat.message)) msgCount += chat.message.length;
        }
      }

      const prefix = c.type === 'group' ? '[Group] ' : '';
      result.chars.push({
        name: prefix + (c.data?.name || c.name || id),
        raw: raw + oh,
        gz: gz + oh,
        chatCount,
        msgCount,
      });
      charRaw += raw + oh;
      charGz += gz + oh;
    } catch {
      result.chars.push({ name: '[오류] char_' + i, raw: 0, gz: 0, chatCount: 0, msgCount: 0 });
    }
  }
  result.chars.sort((a, b) => b.raw - a.raw);
  result.blocks.push({
    name: 'Characters (' + characters.length + '개)',
    raw: charRaw,
    gz: charGz,
  });
  result.totals.raw += charRaw;
  result.totals.gz += charGz;

  // Modules 블록
  progress('모듈 분석 중...');
  const modJson = JSON.stringify(db.modules || []);
  const modRaw = new TextEncoder().encode(modJson).byteLength + blockHead('modules');
  const modGz = (await gzip(modJson)) + blockHead('modules');
  result.blocks.push({ name: 'Modules', raw: modRaw, gz: modGz });
  result.totals.raw += modRaw;
  result.totals.gz += modGz;

  result.blocks.sort((a, b) => b.raw - a.raw);
  return result;
}

// ── HTML 빌더 ──────────────────────────────────────────

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

// ── 렌더링 ─────────────────────────────────────────────

function render(r: AnalysisResult): void {
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
      card(tbl([['이름'], ['원본', 1], ['Gzip', 1], ['압축률', 1]], detailRows(r.chars.slice(0, 50), 'name')) +
        (r.chars.length > 50 ? '<p class="more">...외 ' + (r.chars.length - 50) + '개</p>' : ''), '캐릭터 전체', 'h3') +
    '</div>' +

    '<p class="fn">' + envNote + ' 화이트리스트 외 데이터는 추산에 미포함.</p>';

  document.getElementById('b-cls')!.addEventListener('click', () => { risuai.hideContainer(); });
  document.getElementById('b-ref')!.addEventListener('click', async () => {
    const db = await risuai.getDatabase();
    if (!db) return;
    const info = await risuai.getRuntimeInfo();
    await run(db, info);
  });
  document.getElementById('dt')!.addEventListener('click', () => {
    const d = document.getElementById('dd')!;
    const t = document.getElementById('dt')!;
    t.innerHTML = '상세 ' + (d.classList.toggle('cl') ? '&#9656;' : '&#9662;');
  });
}

// ── CSS ────────────────────────────────────────────────

const STYLES = [
  '*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }',
  'html { background:transparent; }',
  'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:rgba(0,0,0,0.55); color:var(--text); line-height:1.6; min-height:100vh; display:flex; align-items:flex-start; justify-content:center; padding:5vh 20px; }',
  '#app { background:var(--bg2); max-width:820px; width:100%; border-radius:12px; border:1px solid var(--border2); box-shadow:0 16px 48px rgba(0,0,0,0.4); padding:24px; max-height:90vh; overflow-y:auto; }',
  '#app { scrollbar-width:none; }',
  '#app::-webkit-scrollbar { display:none; }',
  '.hd { display:flex; justify-content:flex-end; margin-bottom:8px; }',
  '.ha { display:flex; gap:8px; }',
  '.btn { background:var(--btn); border:1px solid var(--border2); color:var(--text); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:.9em; }',
  '.btn:hover { background:var(--border2); }',
  '.bc { color:var(--red); font-size:1.2em; line-height:1; }',
  '.sum { text-align:center; margin-bottom:20px; }',
  '.sum-big { font-size:2em; font-weight:700; }',
  '.sum-label { font-size:.9em; color:var(--text2); margin-top:4px; }',
  '.stack { display:flex; height:28px; border-radius:6px; overflow:hidden; gap:2px; }',
  '.seg { min-width:4px; border-radius:4px; transition:flex .3s; display:flex; align-items:center; justify-content:center; font-size:.75em; font-weight:600; color:#fff; overflow:hidden; white-space:nowrap; }',
  '.stack-leg { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:10px; font-size:.85em; }',
  '.leg { display:flex; align-items:center; }',
  '.dot { width:10px; height:10px; border-radius:3px; margin-right:6px; flex-shrink:0; }',
  '.c { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:16px 20px; margin-bottom:12px; }',
  'h2 { font-size:1em; color:var(--text); margin-bottom:10px; }',
  'h3 { font-size:.92em; color:var(--text2); margin-bottom:8px; }',
  '.tw { overflow-x:auto; scrollbar-width:none; }',
  '.tw::-webkit-scrollbar { display:none; }',
  'table { width:100%; min-width:400px; border-collapse:collapse; font-size:.88em; }',
  'th { text-align:left; padding:6px 10px; border-bottom:1px solid var(--border2); color:var(--text2); font-weight:600; }',
  'th.n { text-align:right; }',
  'td { padding:5px 10px; border-bottom:1px solid var(--border); }',
  'tbody tr:hover { background:var(--btn); }',
  '.n { text-align:right; font-variant-numeric:tabular-nums; }',
  'td.bv { position:relative; z-index:0; }',
  'td.bv::before { content:""; position:absolute; right:0; top:2px; bottom:2px; width:var(--w,0%); background:var(--accent); opacity:.3; border-radius:3px; pointer-events:none; z-index:-1; }',
  '.tg { cursor:pointer; user-select:none; }',
  '.tg:hover { color:var(--accent); }',
  '.det-tg { font-size:.92em; color:var(--text2); margin:4px 0 8px; }',
  '.cl { display:none; }',
  '.fn { font-size:.82em; color:var(--text2); text-align:center; margin-top:8px; }',
  '.mt { color:var(--text2); }',
  '.more { text-align:center; color:var(--text2); font-style:italic; }',
  '.loading { text-align:center; padding:80px 20px; font-size:1.1em; color:var(--text2); }',
  '.err { text-align:center; padding:80px 20px; color:var(--red); font-size:1.1em; }',
  '@media(max-width:640px) {',
  '  body { padding:0; background:var(--bg2); }',
  '  #app { border-radius:0; max-height:none; border:none; box-shadow:none; }',
  '  .sum-big { font-size:1.4em; }',
  '  .stack-leg { flex-direction:column; }',
  '  table { font-size:.8em; }',
  '  td,th { padding:4px 6px; }',
  '}',
].join('\n');

// ── DOM / 라이프사이클 ─────────────────────────────────

function initDOM(): void {
  if (!document.getElementById('_ps')) {
    const s = document.createElement('style');
    s.id = '_ps';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
  document.body.innerHTML = '<div id="app"></div>';
  document.body.addEventListener('click', (e) => {
    if (e.target === document.body) risuai.hideContainer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') risuai.hideContainer();
  });
}

function showLoadingWithClose(msg: string): void {
  document.getElementById('app')!.innerHTML =
    '<div class="hd">' +
      '<div class="ha"><button id="b-cls-l" class="btn bc">&times;</button></div>' +
    '</div>' +
    '<p id="pg" class="loading">' + esc(msg) + '</p>';
  document.getElementById('b-cls-l')!.addEventListener('click', () => risuai.hideContainer());
}

async function run(db: DatabaseSubset, info: RuntimeInfo): Promise<void> {
  showLoadingWithClose('분석 중...');
  try {
    const r = await analyze(db, info, (msg) => {
      const el = document.getElementById('pg');
      if (el) el.textContent = msg;
    });
    render(r);
  } catch (e: unknown) {
    const pg = document.getElementById('pg');
    if (pg) {
      pg.className = 'err';
      pg.textContent = '오류: ' + (e instanceof Error ? e.message : String(e));
    }
  }
}

function applyTheme(scheme: ThemeColors): void {
  const s = document.documentElement.style;
  s.setProperty('--bg', scheme.bgcolor);
  s.setProperty('--bg2', scheme.darkbg);
  s.setProperty('--border', scheme.borderc);
  s.setProperty('--border2', scheme.darkBorderc);
  s.setProperty('--text', scheme.textcolor);
  s.setProperty('--text2', scheme.textcolor2);
  s.setProperty('--btn', scheme.darkbutton);
  s.setProperty('--accent', scheme.selected);
  s.setProperty('--red', scheme.draculared);
}

// getColorScheme() 시도 → 실패 시 프리셋 테이블에서 colorSchemeName으로 매핑
async function resolveScheme(db: DatabaseSubset): Promise<ThemeColors> {
  try {
    const { scheme } = await risuai.getColorScheme();
    return scheme;
  } catch {
    return PRESET_SCHEMES[db.colorSchemeName ?? ''] || PRESET_SCHEMES['default'];
  }
}

// 진입점 — 풀스크린 전에 DB 권한 요청 (다이얼로그가 가려지지 않도록)
async function open(): Promise<void> {
  try {
    const db = await risuai.getDatabase();
    if (!db) return;
    const [info, scheme] = await Promise.all([
      risuai.getRuntimeInfo(),
      resolveScheme(db),
    ]);

    await risuai.showContainer('fullscreen');
    initDOM();
    applyTheme(scheme);
    await run(db, info);
  } catch {
    try { await risuai.hideContainer(); } catch { /* noop */ }
  }
}

// Settings 페이지에 메뉴 등록 + 언로드 시 정리
(async () => {
  const reg = await risuai.registerSetting('database.bin', open, '&#x1f4e6;', 'html');
  risuai.onUnload(() => { risuai.unregisterUIPart(reg.id); });
})();
