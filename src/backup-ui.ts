import { STYLES } from './constants';
import { esc } from './utils';
import { createBackupPng, readBackupPng, collectAssetPaths, remapAssetPaths } from './backup';
import { applyTheme, resolveScheme } from './theme';

// ── 헬퍼 ───────────────────────────────────────────────

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** 모든 이미지 data URL → PNG Uint8Array. canvas를 거쳐 포맷 변환. */
function imageDataUrlToPng(dataUrl: string): Promise<Uint8Array | undefined> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(undefined); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { resolve(undefined); return; }
        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
      }, 'image/png');
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── 추가 CSS (백업 UI 전용) ────────────────────────────

const BACKUP_CSS = [
  '.bk-tabs { display:flex; gap:0; margin-bottom:16px; border-bottom:2px solid var(--border); }',
  '.bk-tab { padding:8px 20px; cursor:pointer; color:var(--text2); border-bottom:2px solid transparent; margin-bottom:-2px; font-size:.95em; }',
  '.bk-tab:hover { color:var(--text); }',
  '.bk-tab.active { color:var(--text); border-bottom-color:var(--accent); font-weight:600; }',
  '.bk-panel { display:none; }',
  '.bk-panel.active { display:block; }',
  '.bk-char-list { max-height:240px; overflow-y:auto; border:1px solid var(--border2); border-radius:6px; margin-bottom:12px; }',
  '.bk-char-item { display:flex; align-items:center; gap:10px; padding:6px 10px; cursor:pointer; border-bottom:1px solid var(--border); }',
  '.bk-char-item:last-child { border-bottom:none; }',
  '.bk-char-item:hover { background:var(--btn); }',
  '.bk-char-item.selected { background:var(--accent); color:#fff; }',
  '.bk-char-thumb { width:32px; height:32px; border-radius:4px; object-fit:cover; background:var(--border); flex-shrink:0; }',
  '.bk-char-info { flex:1; min-width:0; }',
  '.bk-char-name { font-size:.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
  '.bk-char-meta { font-size:.75em; color:var(--text2); }',
  '.bk-char-item.selected .bk-char-meta { color:rgba(255,255,255,.7); }',
  '.bk-btn { display:inline-block; padding:8px 20px; border-radius:6px; border:1px solid var(--border2); background:var(--accent); color:#fff; cursor:pointer; font-size:.9em; font-weight:600; }',
  '.bk-btn:hover { opacity:.85; }',
  '.bk-btn:disabled { opacity:.4; cursor:not-allowed; }',
  '.bk-btn-danger { background:var(--red); }',
  '.bk-img-wrap { margin:16px 0; text-align:center; }',
  '.bk-img-wrap img { max-width:300px; max-height:300px; border-radius:8px; border:1px solid var(--border); cursor:pointer; }',
  '.bk-img-hint { font-size:.82em; color:var(--text2); margin-top:8px; }',
  '.bk-file-label { display:inline-block; padding:8px 20px; border-radius:6px; border:1px solid var(--border2); background:var(--btn); color:var(--text); cursor:pointer; font-size:.9em; }',
  '.bk-file-label:hover { background:var(--border2); }',
  '.bk-file-input { display:none; }',
  '.bk-preview { margin:16px 0; padding:16px; background:var(--bg); border:1px solid var(--border); border-radius:8px; }',
  '.bk-preview-row { display:flex; justify-content:space-between; padding:4px 0; font-size:.9em; }',
  '.bk-preview-label { color:var(--text2); }',
  '.bk-status { padding:12px; text-align:center; font-size:.9em; color:var(--text2); }',
  '.bk-status.error { color:var(--red); }',
  '.bk-status.success { color:#10b981; }',
  '@keyframes bk-spin { to { transform:rotate(360deg); } }',
  '.bk-spinner { display:inline-block; width:20px; height:20px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:bk-spin .6s linear infinite; vertical-align:middle; margin-right:8px; }',
].join('\n');

// ── 작업 중단 ──────────────────────────────────────────

let activeController: AbortController | null = null;

function abortAndClose(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  risuai.hideContainer();
}

/** signal이 abort되었으면 에러를 던져 async 흐름을 중단 */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

// ── DOM 초기화 ─────────────────────────────────────────

function initBackupDOM(): void {
  if (!$('_ps')) {
    const s = document.createElement('style');
    s.id = '_ps';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
  if (!$('_bk-css')) {
    const s = document.createElement('style');
    s.id = '_bk-css';
    s.textContent = BACKUP_CSS;
    document.head.appendChild(s);
  }
  document.body.innerHTML = '<div id="app"></div>';
  document.body.addEventListener('click', (e) => {
    if (e.target === document.body) abortAndClose();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abortAndClose();
  });
}

// ── 메인 렌더 ──────────────────────────────────────────

interface CharEntry {
  index: number;
  name: string;
  chatCount: number;
  isGroup: boolean;
  imageKey: string | null;
}

function parseCharacterList(db: DatabaseSubset): CharEntry[] {
  if (!Array.isArray(db.characters)) return [];
  return db.characters.map((c: any, i: number) => ({
    index: i,
    name: c.data?.name || c.name || 'char_' + i,
    chatCount: Array.isArray(c.chats) ? c.chats.length : 0,
    isGroup: c.type === 'group',
    imageKey: typeof c.image === 'string' && c.image ? c.image : null,
  }));
}

function renderMain(chars: CharEntry[]): void {
  const app = $('app');
  if (!app) return;

  const listItems = chars
    .map(c => {
      const prefix = c.isGroup ? '[Group] ' : '';
      // 썸네일: 이미지 로딩 전 빈 div placeholder, 로딩 후 img로 교체
      return '<div class="bk-char-item" data-idx="' + c.index + '">' +
        '<div class="bk-char-thumb" data-img-key="' + (c.imageKey ? esc(c.imageKey) : '') + '"></div>' +
        '<div class="bk-char-info">' +
          '<div class="bk-char-name">' + esc(prefix + c.name) + '</div>' +
          '<div class="bk-char-meta">' + c.chatCount + ' chats</div>' +
        '</div>' +
      '</div>';
    })
    .join('');

  app.innerHTML =
    // 헤더
    '<div class="hd"><div class="ha">' +
      '<button id="bk-cls" class="btn bc">&times;</button>' +
    '</div></div>' +

    // 탭
    '<div class="bk-tabs">' +
      '<div class="bk-tab active" data-tab="backup">백업</div>' +
      '<div class="bk-tab" data-tab="restore">복원</div>' +
    '</div>' +

    // 백업 패널
    '<div id="p-backup" class="bk-panel active">' +
      '<div id="bk-char-list" class="bk-char-list">' + listItems + '</div>' +
      '<button id="bk-create" class="bk-btn" disabled>백업 생성</button>' +
      '<div id="bk-result"></div>' +
    '</div>' +

    // 복원 패널
    '<div id="p-restore" class="bk-panel">' +
      '<label class="bk-file-label">' +
        'PNG 파일 선택' +
        '<input id="bk-file" type="file" accept="image/png" class="bk-file-input">' +
      '</label>' +
      '<div id="bk-restore-preview"></div>' +
    '</div>';

  // 이벤트 바인딩
  const closeBtn = $('bk-cls');
  if (closeBtn) closeBtn.addEventListener('click', () => abortAndClose());

  bindTabs();
  bindBackup(chars);
  bindRestore();
  loadThumbnails();
}

// ── 탭 전환 ────────────────────────────────────────────

function bindTabs(): void {
  const tabs = document.querySelectorAll('.bk-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('.bk-panel').forEach(p => p.classList.remove('active'));
      const panel = $('p-' + target);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── 백업 탭 ────────────────────────────────────────────

function bindBackup(chars: CharEntry[]): void {
  const listEl = $('bk-char-list');
  const createBtn = $('bk-create');
  if (!listEl || !createBtn) return;

  let selectedIdx = -1;

  listEl.addEventListener('click', (e) => {
    const item = (e.target instanceof Element) ? e.target.closest('.bk-char-item') : null;
    if (!item || !(item instanceof HTMLElement)) return;

    const idx = parseInt(item.dataset.idx ?? '', 10);
    if (isNaN(idx)) return;

    // 선택 상태 토글
    listEl.querySelectorAll('.bk-char-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    selectedIdx = idx;

    createBtn.removeAttribute('disabled');
    const result = $('bk-result');
    if (result) result.innerHTML = '';
  });

  createBtn.addEventListener('click', async () => {
    const idx = selectedIdx;
    if (idx < 0) return;

    const result = $('bk-result');
    if (!result) return;

    // 이전 작업 중단 후 새 controller 생성
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const { signal } = controller;

    result.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>백업 생성 중...</div>';
    createBtn.setAttribute('disabled', '');

    try {
      const db = await risuai.getDatabase();
      throwIfAborted(signal);
      if (!db || !Array.isArray(db.characters)) {
        result.innerHTML = '<div class="bk-status error">데이터베이스를 읽을 수 없습니다.</div>';
        return;
      }

      const char = db.characters[idx];
      if (!char) {
        result.innerHTML = '<div class="bk-status error">캐릭터를 찾을 수 없습니다.</div>';
        return;
      }

      // 에셋 병렬 수집
      const assetPaths = collectAssetPaths(char);
      const assets: Record<string, string> = {};
      let pngImage: Uint8Array | undefined;

      if (assetPaths.length > 0) {
        let loaded = 0;
        const updateProgress = () => {
          if (signal.aborted) return;
          const status = $('bk-result');
          if (status) {
            status.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>에셋 읽는 중 (' + loaded + '/' + assetPaths.length + ')...</div>';
          }
        };
        updateProgress();

        await Promise.all(assetPaths.map(path =>
          risuai.readImage(path)
            .then((dataUrl: unknown) => {
              if (typeof dataUrl === 'string' && dataUrl) {
                assets[path] = dataUrl;
              }
            })
            .catch(() => { /* 읽기 실패한 에셋은 건너뜀 */ })
            .finally(() => { loaded++; updateProgress(); })
        ));
        throwIfAborted(signal);
      }

      // 메인 이미지를 PNG 썸네일로 변환
      if (typeof char.image === 'string' && assets[char.image]) {
        try {
          pngImage = await imageDataUrlToPng(assets[char.image]);
        } catch { /* placeholder 사용 */ }
      }
      throwIfAborted(signal);

      result.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>백업 PNG 생성 중...</div>';
      const pngBytes = await createBackupPng(char, assets, pngImage);
      const charName = chars.find(c => c.index === idx)?.name ?? 'character';
      const fileName = charName.replace(/[/\\?%*:|"<>]/g, '_') + '.backup.png';

      // CSP img-src *가 data:/blob:을 차단하므로 <img> 표시 불가.
      // <a download>로 직접 다운로드 제공
      const blob = new Blob([toArrayBuffer(pngBytes)], { type: 'image/png' });
      const blobUrl = URL.createObjectURL(blob);

      result.innerHTML =
        '<div class="bk-img-wrap">' +
          '<a id="bk-dl" class="bk-btn" download="' + esc(fileName) + '" href="' + blobUrl + '">' +
            esc(charName) + ' 다운로드 (' + formatSize(pngBytes.byteLength) + ')' +
          '</a>' +
        '</div>';

    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      result.innerHTML = '<div class="bk-status error">오류: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    } finally {
      if (activeController === controller) activeController = null;
      createBtn.removeAttribute('disabled');
    }
  });
}

// ── 썸네일 비동기 로딩 ─────────────────────────────────

function loadThumbnails(): void {
  const thumbs = document.querySelectorAll('.bk-char-thumb[data-img-key]');
  thumbs.forEach(el => {
    if (!(el instanceof HTMLElement)) return;
    const key = el.dataset.imgKey;
    if (!key) return;

    risuai.readImage(key).then(dataUrl => {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
      const img = document.createElement('img');
      img.className = 'bk-char-thumb';
      img.src = dataUrl;
      el.replaceWith(img);
    }).catch(() => { /* placeholder 유지 */ });
  });
}

// ── 복원 탭 ────────────────────────────────────────────

function bindRestore(): void {
  const fileInput = $('bk-file');
  if (!fileInput || !(fileInput instanceof HTMLInputElement)) return;

  fileInput.addEventListener('change', async () => {
    const preview = $('bk-restore-preview');
    if (!preview) return;
    if (!fileInput.files || fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    preview.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>파일 읽는 중...</div>';

    try {
      const arrayBuf = await file.arrayBuffer();
      const png = new Uint8Array(arrayBuf);
      const backup = await readBackupPng(png);

      const payload = backup.payload;
      if (!backup.hasFullBackup || !payload) {
        const msg = backup.hasCharaChunk
          ? 'risubackup 데이터가 없습니다. RisuAI 표준 임포트를 사용하세요.'
          : '유효한 백업 데이터가 없는 파일입니다.';
        preview.innerHTML = '<div class="bk-status error">' + esc(msg) + '</div>';
        return;
      }

      const char = payload.character;
      const assetCount = Object.keys(payload.assets).length;
      const name: string = char.data?.name || char.name || '(이름 없음)';
      let chatCount = 0;
      let msgCount = 0;
      if (Array.isArray(char.chats)) {
        chatCount = char.chats.length;
        for (const chat of char.chats) {
          if (Array.isArray(chat.message)) msgCount += chat.message.length;
        }
      }

      preview.innerHTML =
        '<div class="bk-preview">' +
          '<div class="bk-preview-row"><span class="bk-preview-label">캐릭터</span><span>' + esc(name) + '</span></div>' +
          '<div class="bk-preview-row"><span class="bk-preview-label">채팅</span><span>' + chatCount + '개</span></div>' +
          '<div class="bk-preview-row"><span class="bk-preview-label">메시지</span><span>' + msgCount + '개</span></div>' +
          '<div class="bk-preview-row"><span class="bk-preview-label">에셋</span><span>' + assetCount + '개</span></div>' +
          '<div class="bk-preview-row"><span class="bk-preview-label">버전</span><span>v' + payload.version + '</span></div>' +
        '</div>' +
        '<button id="bk-do-restore" class="bk-btn bk-btn-danger">복원하기</button>' +
        '<div id="bk-restore-status"></div>';

      const restoreBtn = $('bk-do-restore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', () => doRestore(payload));
      }

    } catch (e: unknown) {
      preview.innerHTML = '<div class="bk-status error">파일 읽기 오류: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  });
}

async function doRestore(payload: import('./backup').BackupPayload): Promise<void> {
  const statusEl = $('bk-restore-status');
  const restoreBtn = $('bk-do-restore');

  if (statusEl) statusEl.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>복원 중...</div>';
  if (restoreBtn) restoreBtn.setAttribute('disabled', '');

  try {
    // 1. 에셋 병렬 복원 — saveAsset()으로 저장하고 새 경로 매핑
    const assetEntries = Object.entries(payload.assets);
    const pathMap: Record<string, string> = {};

    if (assetEntries.length > 0) {
      let saved = 0;
      const updateProgress = () => {
        if (statusEl) {
          statusEl.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>에셋 복원 중 (' + saved + '/' + assetEntries.length + ')...</div>';
        }
      };
      updateProgress();

      await Promise.all(assetEntries.map(([oldPath, dataUrl]) =>
        risuai.saveAsset(dataUrl)
          .then((newPath: unknown) => {
            if (typeof newPath === 'string') {
              pathMap[oldPath] = newPath;
            }
          })
          .catch(() => { /* 개별 에셋 실패 시 건너뜀 */ })
          .finally(() => { saved++; updateProgress(); })
      ));
    }

    // 2. 캐릭터 객체의 에셋 경로를 새 경로로 교체
    if (statusEl) {
      statusEl.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>캐릭터 데이터 복원 중...</div>';
    }
    const restoredChar = remapAssetPaths(payload.character, pathMap);

    // 3. DB에 캐릭터 추가
    const db = await risuai.getDatabase();
    if (!db) {
      if (statusEl) statusEl.innerHTML = '<div class="bk-status error">데이터베이스 접근 실패</div>';
      return;
    }

    const characters = Array.isArray(db.characters) ? db.characters : [];
    characters.push(restoredChar);
    db.characters = characters;
    await risuai.setDatabase(db);

    const restored = Object.keys(pathMap).length;
    const failed = assetEntries.length - restored;
    const msg = '복원 완료! 채팅 + 에셋 ' + restored + '개 복원.' +
      (failed > 0 ? ' (' + failed + '개 에셋 실패)' : '');
    if (statusEl) {
      statusEl.innerHTML = '<div class="bk-status success">' + esc(msg) + '</div>';
    }
  } catch (e: unknown) {
    if (statusEl) {
      statusEl.innerHTML = '<div class="bk-status error">복원 실패: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  }
}

// ── 진입점 ─────────────────────────────────────────────

export async function openBackupUI(): Promise<void> {
  try {
    const db = await risuai.getDatabase();
    if (!db) return;

    const scheme = await resolveScheme(db);

    await risuai.showContainer('fullscreen');
    initBackupDOM();
    applyTheme(scheme);

    const chars = parseCharacterList(db);
    renderMain(chars);
  } catch {
    try { await risuai.hideContainer(); } catch { /* noop */ }
  }
}
