import { STYLES } from './constants';
import { esc } from './utils';
import { createBackupPng, readBackupPng } from './backup';
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

function uint8ToDataUrl(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return 'data:image/png;base64,' + btoa(binary);
}

// ── 추가 CSS (백업 UI 전용) ────────────────────────────

const BACKUP_CSS = [
  '.bk-tabs { display:flex; gap:0; margin-bottom:16px; border-bottom:2px solid var(--border); }',
  '.bk-tab { padding:8px 20px; cursor:pointer; color:var(--text2); border-bottom:2px solid transparent; margin-bottom:-2px; font-size:.95em; }',
  '.bk-tab:hover { color:var(--text); }',
  '.bk-tab.active { color:var(--text); border-bottom-color:var(--accent); font-weight:600; }',
  '.bk-panel { display:none; }',
  '.bk-panel.active { display:block; }',
  '.bk-select { width:100%; padding:8px 12px; border-radius:6px; border:1px solid var(--border2); background:var(--btn); color:var(--text); font-size:.9em; margin-bottom:12px; }',
  '.bk-select option { background:var(--bg2); color:var(--text); }',
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
    if (e.target === document.body) risuai.hideContainer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') risuai.hideContainer();
  });
}

// ── 메인 렌더 ──────────────────────────────────────────

interface CharEntry {
  index: number;
  name: string;
  chatCount: number;
  isGroup: boolean;
}

function parseCharacterList(db: DatabaseSubset): CharEntry[] {
  if (!Array.isArray(db.characters)) return [];
  return db.characters.map((c: any, i: number) => ({
    index: i,
    name: c.data?.name || c.name || 'char_' + i,
    chatCount: Array.isArray(c.chats) ? c.chats.length : 0,
    isGroup: c.type === 'group',
  }));
}

function renderMain(chars: CharEntry[]): void {
  const app = $('app');
  if (!app) return;

  const options = chars
    .map(c => {
      const prefix = c.isGroup ? '[Group] ' : '';
      return '<option value="' + c.index + '">' + esc(prefix + c.name) + ' (' + c.chatCount + ' chats)</option>';
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
      '<select id="bk-char-select" class="bk-select">' +
        '<option value="" disabled selected>캐릭터 선택...</option>' +
        options +
      '</select>' +
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
  if (closeBtn) closeBtn.addEventListener('click', () => risuai.hideContainer());

  bindTabs();
  bindBackup(chars);
  bindRestore();
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
  const select = $('bk-char-select');
  const createBtn = $('bk-create');
  if (!select || !createBtn || !(select instanceof HTMLSelectElement)) return;

  select.addEventListener('change', () => {
    createBtn.removeAttribute('disabled');
    // 이전 결과 초기화
    const result = $('bk-result');
    if (result) result.innerHTML = '';
  });

  createBtn.addEventListener('click', async () => {
    const idx = parseInt(select.value, 10);
    if (isNaN(idx)) return;

    const result = $('bk-result');
    if (!result) return;

    result.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>백업 생성 중...</div>';
    createBtn.setAttribute('disabled', '');

    try {
      const db = await risuai.getDatabase();
      if (!db || !Array.isArray(db.characters)) {
        result.innerHTML = '<div class="bk-status error">데이터베이스를 읽을 수 없습니다.</div>';
        return;
      }

      const char = db.characters[idx];
      if (!char) {
        result.innerHTML = '<div class="bk-status error">캐릭터를 찾을 수 없습니다.</div>';
        return;
      }

      // 캐릭터 이미지 → PNG 변환 (JPEG/WebP 등 모든 포맷 지원)
      let pngImage: Uint8Array | undefined;
      if (char.image) {
        try {
          const dataUrl = await risuai.readImage(char.image);
          pngImage = await imageDataUrlToPng(dataUrl);
        } catch { /* placeholder 사용 */ }
      }

      const pngBytes = await createBackupPng(char, pngImage);
      const blobUrl = URL.createObjectURL(
        new Blob([toArrayBuffer(pngBytes)], { type: 'image/png' })
      );

      const charName = chars.find(c => c.index === idx)?.name ?? 'character';

      result.innerHTML =
        '<div class="bk-img-wrap">' +
          '<img id="bk-img" src="' + blobUrl + '" alt="' + esc(charName) + ' 백업">' +
          '<div class="bk-img-hint">우클릭 → 이미지를 다른 이름으로 저장</div>' +
        '</div>';

    } catch (e: unknown) {
      result.innerHTML = '<div class="bk-status error">오류: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    } finally {
      createBtn.removeAttribute('disabled');
    }
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

      if (!backup.hasFullBackup || !backup.character) {
        const msg = backup.hasCharaChunk
          ? 'risubackup 데이터가 없습니다. RisuAI 표준 임포트를 사용하세요.'
          : '유효한 백업 데이터가 없는 파일입니다.';
        preview.innerHTML = '<div class="bk-status error">' + esc(msg) + '</div>';
        return;
      }

      const char = backup.character;
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
        '</div>' +
        '<button id="bk-do-restore" class="bk-btn bk-btn-danger">복원하기</button>' +
        '<div id="bk-restore-status"></div>';

      const restoreBtn = $('bk-do-restore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', () => doRestore(char));
      }

    } catch (e: unknown) {
      preview.innerHTML = '<div class="bk-status error">파일 읽기 오류: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  });
}

async function doRestore(char: any): Promise<void> {
  const statusEl = $('bk-restore-status');
  const restoreBtn = $('bk-do-restore');

  if (statusEl) statusEl.innerHTML = '<div class="bk-status"><span class="bk-spinner"></span>복원 중...</div>';
  if (restoreBtn) restoreBtn.setAttribute('disabled', '');

  try {
    const db = await risuai.getDatabase();
    if (!db) {
      if (statusEl) statusEl.innerHTML = '<div class="bk-status error">데이터베이스 접근 실패</div>';
      return;
    }

    const characters = Array.isArray(db.characters) ? db.characters : [];
    characters.push(char);
    db.characters = characters;
    await risuai.setDatabase(db);

    if (statusEl) {
      statusEl.innerHTML = '<div class="bk-status success">복원 완료! 채팅 포함 모든 데이터가 복원되었습니다.</div>';
    }
  } catch (e: unknown) {
    if (statusEl) {
      statusEl.innerHTML = '<div class="bk-status error">복원 실패: ' +
        esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  }
}

// ── Uint8Array → ArrayBuffer (타입 단언 없이) ──────────

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
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
