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

  const MISSING = [
    {
      cat: 'API 키 & 인증',
      keys: [
        'openAIKey','proxyKey','claudeAPIKey','NAIApiKey','cohereAPIKey',
        'mistralKey','openrouterKey','huggingfaceKey','stabilityKey','falToken',
        'elevenLabKey','supaMemoryKey','hypaMemoryKey','google','vertexPrivateKey',
        'vertexClientEmail','novelai','account','OaiCompAPIKeys','authRefreshes',
        'fishSpeechKey',
      ],
      note: '짧은 문자열 위주. 용량 영향 미미.',
    },
    {
      cat: '프롬프트 & 지시문',
      keys: [
        'mainPrompt','jailbreak','globalNote','additionalPrompt','descriptionPrefix',
        'emotionPrompt','emotionPrompt2','personaPrompt','supaMemoryPrompt',
        'autoSuggestPrompt','translatorPrompt','igpPrompt','OAIPrediction',
        'systemContentReplacement','promptTemplate','promptSettings','globalscript',
        'presetRegex',
      ],
      note: '길이에 따라 수 KB ~ 수십 KB. 유저 설정에 따라 편차 큼.',
    },
    {
      cat: 'botPresets (별도 블록)',
      keys: ['botPresets'],
      note: 'RisuSave에서 별도 블록으로 저장됨. 프리셋 수에 따라 가변적.',
    },
    {
      cat: '글로벌 로어북',
      keys: ['loreBook'],
      note: 'Root 블록에 포함. 항목 수에 따라 수 KB ~ 수 MB.',
    },
    {
      cat: '모델 & 프로바이더',
      keys: [
        'apiType','aiModel','subModel','proxyRequestModel','openrouterRequestModel',
        'customModels','customAPIFormat','formatingOrder','modelTools','fallbackModels',
        'ollamaURL','ollamaModel',
      ],
      note: 'customModels 제외 시 용량 영향 작음.',
    },
    {
      cat: '이미지 생성',
      keys: ['sdProvider','sdConfig','NAIImgConfig','comfyConfig','falModel','falLora'],
      note: 'comfyConfig 제외 시 용량 영향 미미.',
    },
    {
      cat: 'UI & 기타 설정',
      keys: [
        'language','zoomsize','customBackground','fullScreen','iconsize','roundIcons',
        'font','customFont','colorScheme','sendWithEnter','hotkeys','heightMode',
        'username','userIcon','userNote','bias','statics','formatversion','saveTime',
        'globalChatVariables','templateDefaultVariables','cipherChat','ooba',
        'ainconfig','hordeConfig','NAIsettings','hypaV3Settings','hypaV3Presets',
      ],
      note: '대부분 단순 값. 총합 수 KB 수준.',
    },
  ];

  /* ───────── helpers ───────── */

  function fmt(b) {
    if (b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
  }

  function pct(part, whole) {
    return whole === 0 ? '-' : ((part / whole) * 100).toFixed(1) + '%';
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
    const envLabel = { node: 'Node (Docker/서버)', tauri: 'Tauri (데스크탑)', web: 'Web (브라우저)' };
    const saveLabel = { tauri: '로컬 파일', account: '계정 동기화', local: '브라우저 IndexedDB/OPFS' };

    let envNote = '';
    if (r.info.saveMethod === 'account')
      envNote = '계정 동기화 모드에서는 <strong>항상 gzip 블록 압축</strong>이 적용됩니다. Gzip 열이 실제 전송 크기에 가깝습니다.';
    else if (r.info.platform === 'node')
      envNote = 'Node/Docker 환경에서는 HTTP POST로 <code>/api/write</code>에 전송됩니다. 원본 크기 기준입니다.';
    else if (r.info.saveMethod === 'local')
      envNote = '브라우저 로컬 모드: IndexedDB/OPFS에 저장. 네트워크 전송 없음.';
    else if (r.info.platform === 'tauri')
      envNote = 'Tauri 데스크탑: 로컬 파일로 저장. 네트워크 전송 없음.';

    const blocksRows = r.blocks
      .map(
        (b) =>
          '<tr' + (b.partial ? ' class="partial"' : '') + '>' +
          '<td>' + b.name + (b.partial ? ' <span class="tag warn">부분</span>' : '') + '</td>' +
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

    const missingHTML = MISSING.map(
      (m) =>
        '<div class="mg">' +
        '<div class="mc">' + m.cat + ' <span class="tag">' + m.keys.length + '개 키</span></div>' +
        '<div class="mk">' + m.keys.map((k) => '<code>' + k + '</code>').join(' ') + '</div>' +
        '<div class="mn">' + m.note + '</div>' +
        '</div>'
    ).join('');

    const totalMissing = MISSING.reduce((s, m) => s + m.keys.length, 0);

    document.getElementById('app').innerHTML =
      '<div class="hd">' +
        '<h1>DB Size Estimator</h1>' +
        '<div class="ha">' +
          '<button id="b-ref" class="btn">&#8635; 새로고침</button>' +
          '<button id="b-cls" class="btn bc">&times;</button>' +
        '</div>' +
      '</div>' +

      '<section class="c">' +
        '<h2>환경 정보</h2>' +
        '<div class="eg">' +
          '<div><span class="lb">Platform</span><span class="vl">' + (envLabel[r.info.platform] || r.info.platform) + '</span></div>' +
          '<div><span class="lb">Save Method</span><span class="vl">' + (saveLabel[r.info.saveMethod] || r.info.saveMethod) + '</span></div>' +
          '<div><span class="lb">Plugin API</span><span class="vl">v' + r.info.apiVersion + '</span></div>' +
        '</div>' +
        (envNote ? '<p class="en">' + envNote + '</p>' : '') +
      '</section>' +

      '<section class="c">' +
        '<h2>추산 요약</h2>' +
        '<div class="sg">' +
          '<div class="si"><div class="sv">' + fmt(r.totals.raw) + '</div><div class="sl">원본</div></div>' +
          '<div class="si ac"><div class="sv">' + fmt(r.totals.gz) + '</div><div class="sl">Gzip</div></div>' +
          '<div class="si"><div class="sv">' + pct(r.totals.gz, r.totals.raw) + '</div><div class="sl">압축률</div></div>' +
        '</div>' +
        '<p class="wn">접근 가능한 화이트리스트 데이터만 포함한 추산치입니다. ' +
          '접근 불가 키 ' + totalMissing + '개와 botPresets 블록이 누락되어 실제 database.bin은 이보다 큽니다.</p>' +
      '</section>' +

      '<section class="c">' +
        '<h2>RisuSave 블록 구조</h2>' +
        '<table>' +
          '<thead><tr><th>블록</th><th>원본</th><th>Gzip</th><th>압축률</th></tr></thead>' +
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
              '<thead><tr><th>키</th><th>원본</th><th>Gzip</th><th>압축률</th></tr></thead>' +
              '<tbody>' + rootRows + '</tbody>' +
            '</table>'
          : '<p class="mt">접근 가능한 키 중 5B 이상인 데이터가 없습니다.</p>') +
      '</section>' +

      '<section class="c">' +
        '<h2 id="ct" class="tg">캐릭터별 사이즈 (' + r.chars.length + '개) &#9656;</h2>' +
        '<div id="cd" class="cl">' +
          (r.chars.length > 0
            ? '<table>' +
                '<thead><tr><th>이름</th><th>채팅</th><th>메시지</th><th>원본</th><th>Gzip</th></tr></thead>' +
                '<tbody>' + charRows + '</tbody>' +
              '</table>'
            : '<p class="mt">캐릭터가 없습니다.</p>') +
        '</div>' +
      '</section>' +

      '<section class="c">' +
        '<h2>접근 불가 데이터 (누락)</h2>' +
        '<p class="mt">플러그인 화이트리스트에 포함되지 않아 추산에서 빠진 키들입니다. ' +
          '이 데이터는 실제 database.bin의 Root 블록 또는 별도 블록에 포함됩니다.</p>' +
        missingHTML +
      '</section>' +

      '<section class="c note">' +
        '<h2>참고</h2>' +
        '<ul>' +
          '<li>Remote 캐릭터: 일부 캐릭터는 별도 파일(<code>remotes/{chaId}.local.bin</code>)로 분리 저장될 수 있습니다. ' +
            '이 경우 메인 database.bin에는 포인터만 남아 실제 크기는 더 작을 수 있습니다.</li>' +
          '<li>에셋(이미지 등)은 별도 저장되므로 이 추산에 포함되지 않습니다.</li>' +
          '<li>Gzip 크기는 RisuSave의 블록별 개별 압축을 시뮬레이션한 것입니다.</li>' +
        '</ul>' +
      '</section>';

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
    'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0d1117; color:#c9d1d9; padding:20px; line-height:1.6; }',
    '#app { max-width:820px; margin:0 auto; padding-bottom:40px; }',

    '.hd { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid #21262d; }',
    '.hd h1 { font-size:1.35em; color:#f0f6fc; }',
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
    'td { padding:6px 10px; border-bottom:1px solid #161b22; }',
    'tbody tr:hover { background:#1c2128; }',
    '.n { text-align:right; font-variant-numeric:tabular-nums; }',
    'tr.tt { font-weight:700; }',
    'tr.tt td { border-top:2px solid #30363d; color:#f0f6fc; padding-top:10px; }',
    'tr.partial td { color:#e3b341; }',

    'code { background:#1c2128; padding:2px 6px; border-radius:4px; font-size:.86em; color:#79c0ff; }',
    '.tag { display:inline-block; padding:1px 8px; border-radius:10px; font-size:.78em; margin-left:4px; background:#1f6feb33; color:#58a6ff; }',
    '.tag.warn { background:#e3b34133; color:#e3b341; }',

    '.eg { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }',
    '.eg>div { background:#0d1117; padding:12px; border-radius:6px; text-align:center; }',
    '.lb { display:block; font-size:.78em; color:#8b949e; }',
    '.vl { display:block; font-size:.95em; color:#f0f6fc; margin-top:4px; }',
    '.en { margin-top:12px; padding:10px 14px; background:#0d1117; border-left:3px solid #1f6feb; border-radius:4px; font-size:.88em; }',

    '.sg { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }',
    '.si { text-align:center; padding:16px; background:#0d1117; border-radius:8px; }',
    '.si.ac { background:#1f6feb1a; border:1px solid #1f6feb44; }',
    '.sv { font-size:1.5em; font-weight:700; color:#f0f6fc; }',
    '.sl { font-size:.82em; color:#8b949e; margin-top:4px; }',
    '.wn { margin-top:14px; padding:10px 14px; background:#f851491a; border-radius:6px; font-size:.85em; color:#f85149; }',

    '.tg { cursor:pointer; user-select:none; }',
    '.tg:hover { color:#58a6ff; }',
    '.cl { display:none; }',

    '.mg { padding:12px; margin-bottom:8px; background:#0d1117; border-radius:6px; }',
    '.mc { font-weight:600; color:#f0f6fc; margin-bottom:6px; }',
    '.mk { margin-bottom:6px; line-height:2.2; }',
    '.mk code { margin-right:4px; }',
    '.mn { font-size:.84em; color:#8b949e; }',

    '.mt { font-size:.9em; color:#8b949e; }',
    '.more { text-align:center; color:#8b949e; font-style:italic; }',
    '.loading { text-align:center; padding:80px 20px; font-size:1.1em; color:#8b949e; }',
    '.err { text-align:center; padding:80px 20px; color:#f85149; font-size:1.1em; }',

    '@media(max-width:640px) {',
    '  .eg,.sg { grid-template-columns:1fr; }',
    '  table { font-size:.8em; }',
    '  td,th { padding:4px 6px; }',
    '  body { padding:12px; }',
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
  }

  function showLoadingWithClose(msg) {
    const app = document.getElementById('app');
    app.innerHTML =
      '<div class="hd">' +
        '<h1>DB Size Estimator</h1>' +
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
