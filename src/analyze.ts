import type { AnalysisResult, RuntimeInfo, RootKeyInfo } from './types';
import { ROOT_KEYS } from './constants';
import { gzip, blockHead } from './utils';

export async function analyze(
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
    try {
      const val = (db as Record<string, unknown>)[key];
      if (val === undefined || val === null) continue;
      rootObj[key] = val;

      const json = JSON.stringify(val);
      const raw = new TextEncoder().encode(json).byteLength;
      if (raw < 5) continue;
      const gz = await gzip(json);
      const entry: RootKeyInfo = { key, raw, gz };

      // pluginCustomStorage: 플러그인별 breakdown
      if (key === 'pluginCustomStorage' && val && typeof val === 'object' && !Array.isArray(val)) {
        const children: RootKeyInfo[] = [];
        for (const pluginName of Object.keys(val as Record<string, unknown>)) {
          try {
            const pluginVal = (val as Record<string, unknown>)[pluginName];
            if (pluginVal === undefined || pluginVal === null) continue;
            const pJson = JSON.stringify(pluginVal);
            const pRaw = new TextEncoder().encode(pJson).byteLength;
            if (pRaw < 5) continue;
            const pGz = await gzip(pJson);
            children.push({ key: pluginName, raw: pRaw, gz: pGz });
          } catch {
            children.push({ key: pluginName + ' [분석 실패]', raw: 0, gz: 0 });
          }
        }
        if (children.length > 0) {
          children.sort((a, b) => b.raw - a.raw);
          entry.children = children;
        }
      }

      result.rootKeys.push(entry);
    } catch {
      result.rootKeys.push({ key: key + ' [분석 실패]', raw: 0, gz: 0 });
    }
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

      // enableRemoteSaving 시 database.bin에 들어가는 REMOTE 참조 블록 크기
      const refJson = JSON.stringify({ v: 1, type: 2, name: id });
      const remoteRefSize = new TextEncoder().encode(refJson).byteLength + oh;

      let chatCount = 0;
      let msgCount = 0;
      if (Array.isArray(c.chats)) {
        chatCount = c.chats.length;
        for (const chat of c.chats) {
          if (Array.isArray(chat.message)) msgCount += chat.message.length;
        }
      }

      // 하위 항목별 용량 측정
      const enc = new TextEncoder();
      const chatsSize = Array.isArray(c.chats)
        ? enc.encode(JSON.stringify(c.chats)).byteLength : 0;
      const lorebook = c.data?.globalLore ?? c.globalLore;
      const lorebookSize = Array.isArray(lorebook)
        ? enc.encode(JSON.stringify(lorebook)).byteLength : 0;
      // 에셋: 캐릭터 이미지 + 이모션 이미지 + additionalAssets
      let assetsSize = 0;
      if (typeof c.image === 'string') assetsSize += enc.encode(c.image).byteLength;
      if (Array.isArray(c.emotionImages))
        assetsSize += enc.encode(JSON.stringify(c.emotionImages)).byteLength;
      if (Array.isArray(c.data?.additionalAssets))
        assetsSize += enc.encode(JSON.stringify(c.data.additionalAssets)).byteLength;

      const groupTag = c.type === 'group' ? '[Group] ' : '';
      const trashTag = typeof c.trashTime === 'number' ? '[휴지통] ' : '';
      result.chars.push({
        name: trashTag + groupTag + (c.data?.name || c.name || id),
        raw: raw + oh,
        gz: gz + oh,
        chatCount,
        msgCount,
        breakdown: {
          chats: chatsSize,
          lorebook: lorebookSize,
          assets: assetsSize,
          other: Math.max(0, raw - chatsSize - lorebookSize - assetsSize),
        },
        remoteRefSize,
      });
      charRaw += raw + oh;
      charGz += gz + oh;
    } catch {
      result.chars.push({
        name: '[오류] char_' + i, raw: 0, gz: 0, chatCount: 0, msgCount: 0,
        breakdown: { chats: 0, lorebook: 0, assets: 0, other: 0 },
        remoteRefSize: 0,
      });
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
