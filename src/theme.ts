import type { ThemeColors } from './types';
import { PRESET_SCHEMES } from './constants';

export function applyTheme(scheme: ThemeColors): void {
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
export async function resolveScheme(db: DatabaseSubset): Promise<ThemeColors> {
  try {
    const { scheme } = await risuai.getColorScheme();
    return scheme;
  } catch {
    return PRESET_SCHEMES[db.colorSchemeName ?? ''] || PRESET_SCHEMES['default'];
  }
}
