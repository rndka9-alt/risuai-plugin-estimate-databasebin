/** ColorScheme에서 테마 적용에 필요한 필드만 추린 서브셋 */
export type ThemeColors = Pick<
  ColorScheme,
  'bgcolor' | 'darkbg' | 'borderc' | 'selected' | 'draculared' |
  'textcolor' | 'textcolor2' | 'darkBorderc' | 'darkbutton'
>;

export interface SizeEntry {
  raw: number;
  gz: number;
}

export interface BlockInfo extends SizeEntry {
  name: string;
}

export interface RootKeyInfo extends SizeEntry {
  key: string;
}

export interface CharInfo extends SizeEntry {
  name: string;
  chatCount: number;
  msgCount: number;
}

export interface RuntimeInfo {
  apiVersion: string;
  platform: string;
  saveMethod: string;
}

export interface AnalysisResult {
  info: RuntimeInfo;
  blocks: BlockInfo[];
  rootKeys: RootKeyInfo[];
  chars: CharInfo[];
  totals: SizeEntry;
}
