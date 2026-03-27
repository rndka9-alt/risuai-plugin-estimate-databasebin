//@name DB Size Estimator
//@description database.bin 용량을 RisuSave 블록 포맷 기준으로 추산합니다
//@api 3.0

(async () => {
  /* ───────── constants ───────── */

  const ROOT_KEYS = [
    'enabledModules', 'moduleIntergration', 'pluginV2', 'personas', 'plugins',
    'pluginCustomStorage', 'temperature', 'askRemoval', 'maxContext', 'maxResponse',
    'frequencyPenalty', 'PresensePenalty', 'theme', 'textTheme', 'lineHeight',
    'seperateModelsForAxModels', 'seperateModels', 'customCSS', 'guiHTML',
    'colorSchemeName', 'selectedPersona', 'characterOrder',
  ];

  /* ───────── helpers ───────── */

  function fmt(b) {
    if (b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
  }

  // 압축률: 양수 = 줄어듦, 음수 = 오히려 커짐
  function pct(gz, raw) {
    return raw === 0 ? '-' : ((1 - gz / raw) * 100).toFixed(1) + '%';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // RisuSave 블록 헤더: type(1) + compression(1) + nameLen(1) + name + dataLen(4)
  function blockHead(name) {
    return 7 + new TextEncoder().encode(name).byteLength;
  }

  async function gzip(data) {
    const buf =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (buf.byteLength === 0) return 0;

    if (typeof CompressionStream === 'undefined') {
      return Math.ceil(buf.byteLength * 0.6);
    }

    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    return total;
  }

  /* ───────── analysis ───────── */

  async function analyze(db, info, progress) {

    const HEADER_SIZE = 9; // RISUSAVE\0
    const result = {
      info,
      blocks: [],
      rootKeys: [],
      chars: [],
      totals: { raw: HEADER_SIZE, gz: HEADER_SIZE },
    };

    // ── Config block ──
    const cfgJson = JSON.stringify({ version: 1 });
    const cfgSize = new TextEncoder().encode(cfgJson).byteLength + blockHead('config');
    result.blocks.push({ name: 'Config', raw: cfgSize, gz: cfgSize });
    result.totals.raw += cfgSize;
    result.totals.gz += cfgSize;

    // ── Root block (accessible portion) ──
    progress('Root 블록 분석 중...');
    const rootObj = {};
    for (const key of ROOT_KEYS) {
      const val = db[key];
      if (val === undefined || val === null) continue;
      rootObj[key] = val;

      const json = JSON.stringify(val);
      const raw = new TextEncoder().encode(json).byteLength;
      if (raw < 5) continue;
      const gz = await gzip(json);
      result.rootKeys.push({ key, raw, gz });
    }
    result.rootKeys.sort((a, b) => b.raw - a.raw);

    const rootJson = JSON.stringify(rootObj);
    const rootRaw = new TextEncoder().encode(rootJson).byteLength + blockHead('root');
    const rootGz = (await gzip(rootJson)) + blockHead('root');
    result.blocks.push({ name: 'Root (접근 가능 부분)', raw: rootRaw, gz: rootGz, partial: true });
    result.totals.raw += rootRaw;
    result.totals.gz += rootGz;

    // ── Character blocks ──
    let charRaw = 0;
    let charGz = 0;
    const characters = Array.isArray(db.characters) ? db.characters : [];

    for (let i = 0; i < characters.length; i++) {
      progress('캐릭터 분석 중... (' + (i + 1) + '/' + characters.length + ')');
      const c = characters[i];
      const json = JSON.stringify(c);
      const raw = new TextEncoder().encode(json).byteLength;
      const gz = await gzip(json);
      const id = c.chaId || 'char_' + i;
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
    }
    result.chars.sort((a, b) => b.raw - a.raw);
    result.blocks.push({
      name: 'Characters (' + characters.length + '개)',
      raw: charRaw,
      gz: charGz,
    });
    result.totals.raw += charRaw;
    result.totals.gz += charGz;

    // ── Modules block ──
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

  /* ───────── render ───────── */

  function render(r) {
    const blocksRows = r.blocks
      .map(
        (b) =>
          '<tr>' +
          '<td>' + b.name + '</td>' +
          '<td class="n">' + fmt(b.raw) + '</td>' +
          '<td class="n">' + fmt(b.gz) + '</td>' +
          '<td class="n">' + pct(b.gz, b.raw) + '</td>' +
          '</tr>'
      )
      .join('');

    const rootRows = r.rootKeys
      .map(
        (k) =>
          '<tr><td><code>' + k.key + '</code></td>' +
          '<td class="n">' + fmt(k.raw) + '</td>' +
          '<td class="n">' + fmt(k.gz) + '</td>' +
          '<td class="n">' + pct(k.gz, k.raw) + '</td></tr>'
      )
      .join('');

    const charLimit = 50;
    let charRows = r.chars
      .slice(0, charLimit)
      .map(
        (c) =>
          '<tr><td title="' + esc(c.name) + '">' + esc(c.name.length > 30 ? c.name.slice(0, 28) + '...' : c.name) + '</td>' +
          '<td class="n">' + (c.chatCount || '-') + '</td>' +
          '<td class="n">' + (c.msgCount || '-') + '</td>' +
          '<td class="n">' + fmt(c.raw) + '</td>' +
          '<td class="n">' + fmt(c.gz) + '</td></tr>'
      )
      .join('');
    if (r.chars.length > charLimit)
      charRows += '<tr><td colspan="5" class="more">...외 ' + (r.chars.length - charLimit) + '개</td></tr>';

    // 환경별 추신
    let envNote = '';
    if (r.info.saveMethod === 'account')
      envNote = '계정 동기화: 블록별 gzip 압축 적용. Gzip 열이 실제 전송 크기에 가깝습니다.';
    else if (r.info.platform === 'node')
      envNote = 'Node/Docker: 원본 열이 실제 전송 크기에 가깝습니다.';
    else if (r.info.platform === 'tauri')
      envNote = 'Tauri: 로컬 파일 저장. 네트워크 전송 없음.';
    else
      envNote = '브라우저 로컬 저장. 네트워크 전송 없음.';

    document.getElementById('app').innerHTML =
      '<div class="hd">' +
        '<div class="ha">' +
          '<button id="b-ref" class="btn">&#8635; 새로고침</button>' +
          '<button id="b-cls" class="btn bc">&times;</button>' +
        '</div>' +
      '</div>' +

      '<section class="c">' +
        '<div class="sg">' +
          '<div class="si"><div class="sv">' + fmt(r.totals.raw) + '</div><div class="sl">원본</div></div>' +
          '<div class="si ac"><div class="sv">' + fmt(r.totals.gz) + '</div><div class="sl">Gzip</div></div>' +
          '<div class="si"><div class="sv">' + pct(r.totals.gz, r.totals.raw) + '</div><div class="sl">압축률</div></div>' +
        '</div>' +
      '</section>' +

      '<section class="c">' +
        '<h2>RisuSave 블록 구조</h2>' +
        '<table>' +
          '<thead><tr><th>블록</th><th class="n">원본</th><th class="n">Gzip</th><th class="n">압축률</th></tr></thead>' +
          '<tbody>' + blocksRows +
            '<tr class="tt"><td>합계 (추산)</td><td class="n">' + fmt(r.totals.raw) + '</td>' +
            '<td class="n">' + fmt(r.totals.gz) + '</td>' +
            '<td class="n">' + pct(r.totals.gz, r.totals.raw) + '</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</section>' +

      '<section class="c">' +
        '<h2>Root 키별 사이즈</h2>' +
        (r.rootKeys.length > 0
          ? '<table>' +
              '<thead><tr><th>키</th><th class="n">원본</th><th class="n">Gzip</th><th class="n">압축률</th></tr></thead>' +
              '<tbody>' + rootRows + '</tbody>' +
            '</table>'
          : '<p class="mt">접근 가능한 키 중 5B 이상인 데이터가 없습니다.</p>') +
      '</section>' +

      '<section class="c">' +
        '<h2 id="ct" class="tg">캐릭터별 사이즈 (' + r.chars.length + '개) &#9656;</h2>' +
        '<div id="cd" class="cl">' +
          (r.chars.length > 0
            ? '<table>' +
                '<thead><tr><th>이름</th><th class="n">채팅</th><th class="n">메시지</th><th class="n">원본</th><th class="n">Gzip</th></tr></thead>' +
                '<tbody>' + charRows + '</tbody>' +
              '</table>'
            : '<p class="mt">캐릭터가 없습니다.</p>') +
        '</div>' +
      '</section>' +

      '<p class="fn">' + envNote + ' 화이트리스트 외 데이터는 추산에 미포함.</p>';

    // ── events ──
    document.getElementById('b-cls').addEventListener('click', () => risuai.hideContainer());
    document.getElementById('b-ref').addEventListener('click', async () => {
      // 권한은 첫 승인 후 캐시되므로 풀스크린 상태에서도 동작
      const db = await risuai.getDatabase();
      const info = await risuai.getRuntimeInfo();
      await run(db, info);
    });
    document.getElementById('ct').addEventListener('click', () => {
      const d = document.getElementById('cd');
      const t = document.getElementById('ct');
      const open = d.classList.toggle('cl');
      t.innerHTML = '캐릭터별 사이즈 (' + r.chars.length + '개) ' + (open ? '&#9656;' : '&#9662;');
    });
  }

  /* ───────── CSS ───────── */

  const CSS = [
    '*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }',
    'html { background:transparent; }',
    'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:rgba(0,0,0,0.55); color:#c9d1d9; line-height:1.6; min-height:100vh; display:flex; align-items:flex-start; justify-content:center; padding:5vh 20px; }',
    '#app { background:#0d1117; max-width:820px; width:100%; border-radius:12px; border:1px solid #30363d; box-shadow:0 16px 48px rgba(0,0,0,0.4); padding:24px; max-height:90vh; overflow-y:auto; }',
    '#app::-webkit-scrollbar { width:8px; }',
    '#app::-webkit-scrollbar-track { background:transparent; }',
    '#app::-webkit-scrollbar-thumb { background:#30363d; border-radius:4px; }',

    '.hd { display:flex; justify-content:flex-end; align-items:center; margin-bottom:16px; }',
    '.ha { display:flex; gap:8px; }',
    '.btn { background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:.9em; }',
    '.btn:hover { background:#30363d; }',
    '.bc { color:#f85149; font-size:1.2em; line-height:1; }',

    '.c { background:#161b22; border:1px solid #21262d; border-radius:8px; padding:20px; margin-bottom:16px; }',
    '.c.note { background:#0d1117; border-color:#30363d; }',
    '.c.note ul { padding-left:20px; font-size:.88em; color:#8b949e; }',
    '.c.note li { margin-bottom:6px; }',
    'h2 { font-size:1.05em; color:#f0f6fc; margin-bottom:12px; }',

    'table { width:100%; border-collapse:collapse; font-size:.88em; }',
    'th { text-align:left; padding:8px 10px; border-bottom:1px solid #30363d; color:#8b949e; font-weight:600; }',
    'th.n { text-align:right; }',
    'td { padding:6px 10px; border-bottom:1px solid #161b22; }',
    'tbody tr:hover { background:#1c2128; }',
    '.n { text-align:right; font-variant-numeric:tabular-nums; }',
    'tr.tt { font-weight:700; }',
    'tr.tt td { border-top:2px solid #30363d; color:#f0f6fc; padding-top:10px; }',

    'code { background:#1c2128; padding:2px 6px; border-radius:4px; font-size:.86em; color:#79c0ff; }',
    '.tag { display:inline-block; padding:1px 8px; border-radius:10px; font-size:.78em; margin-left:4px; background:#1f6feb33; color:#58a6ff; }',
    '.tag.warn { background:#e3b34133; color:#e3b341; }',

    '.sg { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }',
    '.si { text-align:center; padding:16px; background:#0d1117; border-radius:8px; }',
    '.si.ac { background:#1f6feb1a; border:1px solid #1f6feb44; }',
    '.sv { font-size:1.5em; font-weight:700; color:#f0f6fc; }',
    '.sl { font-size:.82em; color:#8b949e; margin-top:4px; }',
    '.tg { cursor:pointer; user-select:none; }',
    '.tg:hover { color:#58a6ff; }',
    '.cl { display:none; }',

    '.fn { font-size:.82em; color:#8b949e; text-align:center; margin-top:4px; }',
    '.mt { font-size:.9em; color:#8b949e; }',
    '.more { text-align:center; color:#8b949e; font-style:italic; }',
    '.loading { text-align:center; padding:80px 20px; font-size:1.1em; color:#8b949e; }',
    '.err { text-align:center; padding:80px 20px; color:#f85149; font-size:1.1em; }',

    '@media(max-width:640px) {',
    '  body { padding:0; background:#0d1117; }',
    '  #app { border-radius:0; max-height:none; border:none; box-shadow:none; }',
    '  .eg,.sg { grid-template-columns:1fr; }',
    '  table { font-size:.8em; }',
    '  td,th { padding:4px 6px; }',
    '}',
  ].join('\n');

  /* ───────── bootstrap ───────── */

  function initDOM() {
    if (!document.getElementById('_ps')) {
      const s = document.createElement('style');
      s.id = '_ps';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    document.body.innerHTML = '<div id="app"></div>';

    // backdrop 클릭 시 닫기 (모달 바깥 영역)
    document.body.addEventListener('click', (e) => {
      if (e.target === document.body) risuai.hideContainer();
    });
  }

  function showLoadingWithClose(msg) {
    const app = document.getElementById('app');
    app.innerHTML =
      '<div class="hd">' +
        '<div class="ha"><button id="b-cls-l" class="btn bc">&times;</button></div>' +
      '</div>' +
      '<p id="pg" class="loading">' + esc(msg) + '</p>';
    document.getElementById('b-cls-l').addEventListener('click', () => risuai.hideContainer());
  }

  async function run(db, info) {
    showLoadingWithClose('분석 중...');
    try {
      const r = await analyze(db, info, (msg) => {
        const el = document.getElementById('pg');
        if (el) el.textContent = msg;
      });
      render(r);
    } catch (e) {
      document.getElementById('pg').className = 'err';
      document.getElementById('pg').textContent = '오류: ' + e.message;
    }
  }

  async function open() {
    // 풀스크린 띄우기 전에 DB 접근 요청 (권한 다이얼로그가 가려지지 않도록)
    const db = await risuai.getDatabase();
    const info = await risuai.getRuntimeInfo();

    await risuai.showContainer('fullscreen');
    initDOM();
    await run(db, info);
  }

  await risuai.registerSetting('DB Size Estimator', open, '&#x1f4e6;', 'html');
})();
