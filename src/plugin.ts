import type { RuntimeInfo, EnvMode } from './types';
import { STYLES, ROOT_KEYS } from './constants';
import { esc } from './utils';
import { analyze } from './analyze';
import { render, envModeFromInfo } from './render';
import { applyTheme, resolveScheme } from './theme';
// TODO: 백업/복원 기능 미완성 — 복원 시 에셋 경로 매핑 문제 등 미해결
// import { openBackupUI } from './backup-ui';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function fetchDb(
  signal: AbortSignal,
  progress: (msg: string) => void,
): Promise<DatabaseSubset | null> {
  // 1차: 전체 조회
  progress('전체 데이터 조회 중...');
  try {
    const db = await risuai.getDatabase();
    throwIfAborted(signal);
    if (db) return db;
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  // 2차: 설정 + 모듈 (캐릭터 제외)
  progress('개별 조회로 전환 — 설정: root keys + 모듈: modules');
  let db: DatabaseSubset | null;
  try {
    db = await risuai.getDatabase([...ROOT_KEYS, 'modules']);
    throwIfAborted(signal);
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // 3차: 설정만 (모듈도 제외)
    progress('개별 조회로 전환 — 설정: root keys (모듈 제외)');
    db = await risuai.getDatabase(ROOT_KEYS);
    throwIfAborted(signal);
  }
  if (!db) return null;

  // 모듈이 빠졌으면 별도 조회
  if (!db.modules) {
    progress('모듈: modules');
    try {
      const modDb = await risuai.getDatabase(['modules']);
      throwIfAborted(signal);
      if (modDb) db.modules = modDb.modules;
    } catch {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    }
  }
  db.modules ??= [];

  // 캐릭터 개별 조회
  db.characters = [];
  for (let i = 0; ; i++) {
    throwIfAborted(signal);
    progress('캐릭터: ' + (i + 1) + '번째');
    try {
      const char = await risuai.getCharacterFromIndex(i);
      if (!char) break;
      db.characters.push(char);
    } catch {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      db.characters.push({
        chaId: 'error_' + i, data: { name: '[로드 실패] char_' + i }, chats: [],
      });
    }
  }

  return db;
}

// ── DOM ───────────────────────────────────────────────

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

function showLoadingWithCancel(msg: string, controller: AbortController): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML =
    '<div class="hd">' +
      '<div class="ha"><button id="b-cancel" class="btn bc">&times;</button></div>' +
    '</div>' +
    '<p id="pg" class="loading">' + esc(msg) + '</p>';
  const btn = document.getElementById('b-cancel');
  if (btn) btn.addEventListener('click', () => controller.abort());
}

function showLoadingWithClose(msg: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML =
    '<div class="hd">' +
      '<div class="ha"><button id="b-cls-l" class="btn bc">&times;</button></div>' +
    '</div>' +
    '<p id="pg" class="loading">' + esc(msg) + '</p>';
  const btn = document.getElementById('b-cls-l');
  if (btn) btn.addEventListener('click', () => risuai.hideContainer());
}

// ── 분석 + 렌더 ──────────────────────────────────────

async function run(db: DatabaseSubset, info: RuntimeInfo, modeOverride?: EnvMode): Promise<void> {
  showLoadingWithClose('분석 중...');
  try {
    const r = await analyze(db, info, (msg) => {
      const el = document.getElementById('pg');
      if (el) el.textContent = msg;
    });
    const mode = modeOverride ?? envModeFromInfo(info);
    render(r, async (currentMode) => {
      const controller = new AbortController();
      showLoadingWithCancel('데이터 조회 중...', controller);
      try {
        const freshDb = await fetchDb(controller.signal, (msg) => {
          const el = document.getElementById('pg');
          if (el) el.textContent = msg;
        });
        if (!freshDb) return;
        const freshInfo = await risuai.getRuntimeInfo();
        await run(freshDb, freshInfo, currentMode);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          risuai.hideContainer();
        }
      }
    }, mode);
  } catch (e: unknown) {
    const pg = document.getElementById('pg');
    if (pg) {
      pg.className = 'err';
      pg.textContent = '오류: ' + (e instanceof Error ? e.message : String(e));
    }
  }
}

// ── 진입점 ────────────────────────────────────────────

async function open(): Promise<void> {
  try {
    // DB 권한을 풀스크린 전에 요청 (다이얼로그가 가려지지 않도록)
    const permCheck = await risuai.getDatabase(['temperature']);
    if (!permCheck) return;

    await risuai.showContainer('fullscreen');
    initDOM();

    // 테마 먼저 적용 (getColorScheme은 DB 불필요)
    const scheme = await resolveScheme(permCheck);
    applyTheme(scheme);

    const controller = new AbortController();
    showLoadingWithCancel('데이터 조회 중...', controller);

    const db = await fetchDb(controller.signal, (msg) => {
      const el = document.getElementById('pg');
      if (el) el.textContent = msg;
    });
    if (!db) { risuai.hideContainer(); return; }

    const info = await risuai.getRuntimeInfo();
    await run(db, info);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      try { risuai.hideContainer(); } catch { /* noop */ }
      return;
    }
    try { await risuai.hideContainer(); } catch { /* noop */ }
  }
}

// Settings 페이지에 메뉴 등록 + 언로드 시 정리
(async () => {
  const estimateReg = await risuai.registerSetting('database.bin', open, '&#x1f4e6;', 'html');
  risuai.onUnload(() => {
    risuai.unregisterUIPart(estimateReg.id);
  });
})();
