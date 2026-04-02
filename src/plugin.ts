import type { RuntimeInfo } from './types';
import { STYLES } from './constants';
import { esc } from './utils';
import { analyze } from './analyze';
import { render } from './render';
import { applyTheme, resolveScheme } from './theme';

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
    render(r, async () => {
      const freshDb = await risuai.getDatabase();
      if (!freshDb) return;
      const freshInfo = await risuai.getRuntimeInfo();
      await run(freshDb, freshInfo);
    });
  } catch (e: unknown) {
    const pg = document.getElementById('pg');
    if (pg) {
      pg.className = 'err';
      pg.textContent = '오류: ' + (e instanceof Error ? e.message : String(e));
    }
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
