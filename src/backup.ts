// ── PNG 유틸 ───────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  // length (4 bytes big-endian)
  chunk[0] = (len >>> 24) & 0xff;
  chunk[1] = (len >>> 16) & 0xff;
  chunk[2] = (len >>> 8) & 0xff;
  chunk[3] = len & 0xff;
  // type (4 bytes)
  chunk.set(typeBytes, 4);
  // data
  chunk.set(data, 8);
  // CRC of type + data
  const crcBuf = new Uint8Array(4 + len);
  crcBuf.set(typeBytes, 0);
  crcBuf.set(data, 4);
  const crc = crc32(crcBuf);
  chunk[8 + len] = (crc >>> 24) & 0xff;
  chunk[9 + len] = (crc >>> 16) & 0xff;
  chunk[10 + len] = (crc >>> 8) & 0xff;
  chunk[11 + len] = crc & 0xff;
  return chunk;
}

function makeTEXtChunk(key: string, value: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  const valBytes = new TextEncoder().encode(value);
  const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
  data.set(keyBytes, 0);
  // null separator
  data[keyBytes.length] = 0;
  data.set(valBytes, keyBytes.length + 1);
  return makePngChunk('tEXt', data);
}

interface PngTEXtEntry {
  key: string;
  value: string;
}

/** PNG에서 모든 tEXt 청크를 추출 */
export function parsePngTEXt(png: Uint8Array): PngTEXtEntry[] {
  const entries: PngTEXtEntry[] = [];
  let pos = 8; // PNG signature 건너뜀
  while (pos < png.length) {
    const len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    const type = new TextDecoder().decode(png.slice(pos + 4, pos + 8));
    if (type === 'IEND') break;
    if (type === 'tEXt') {
      const data = png.slice(pos + 8, pos + 8 + len);
      let nullIdx = 0;
      while (nullIdx < data.length && data[nullIdx] !== 0) nullIdx++;
      const key = new TextDecoder().decode(data.slice(0, nullIdx));
      const value = new TextDecoder().decode(data.slice(nullIdx + 1));
      entries.push({ key, value });
    }
    pos += 12 + len;
  }
  return entries;
}

/** PNG의 IEND 직전에 tEXt 청크들을 삽입 */
function injectTEXtChunks(png: Uint8Array, chunks: Uint8Array[]): Uint8Array {
  // IEND 위치 찾기
  let iendPos = 8;
  while (iendPos < png.length) {
    const len = (png[iendPos] << 24) | (png[iendPos + 1] << 16) | (png[iendPos + 2] << 8) | png[iendPos + 3];
    const type = new TextDecoder().decode(png.slice(iendPos + 4, iendPos + 8));
    if (type === 'IEND') break;
    iendPos += 12 + len;
  }

  const totalInsert = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(png.length + totalInsert);
  // IEND 이전 복사
  result.set(png.slice(0, iendPos), 0);
  // tEXt 청크들 삽입
  let offset = iendPos;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  // IEND 이후 복사
  result.set(png.slice(iendPos), offset);
  return result;
}

// 1x1 투명 PNG (최소 유효 PNG)
const PLACEHOLDER_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, // IEND
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

// ── 압축 ───────────────────────────────────────────────

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream API not available');
  }
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream API not available');
  }
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

// ── base64 ─────────────────────────────────────────────

function uint8ToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

// ── 캐릭터 카드 V2 빌더 ───────────────────────────────

/** db.characters[i]에서 RisuAI 호환 CharacterCardV2 JSON 생성 */
function buildCharaCardV2(char: any): object {
  const lorebook = Array.isArray(char.globalLore) ? char.globalLore : [];
  const entries = lorebook.map((lore: any, i: number) => ({
    keys: Array.isArray(lore.key) ? lore.key : (typeof lore.key === 'string' ? lore.key.split(',') : []),
    content: lore.content ?? '',
    extensions: {},
    enabled: true,
    insertion_order: lore.insertorder ?? i,
    name: lore.comment ?? '',
    comment: lore.comment ?? '',
    selective: lore.selective ?? false,
    secondary_keys: Array.isArray(lore.secondkey) ? lore.secondkey : [],
    constant: lore.alwaysActive ?? false,
  }));

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: char.name ?? '',
      description: char.desc ?? '',
      personality: char.personality ?? '',
      scenario: char.scenario ?? '',
      first_mes: char.firstMessage ?? '',
      mes_example: char.exampleMessage ?? '',
      creator_notes: char.creatorNotes ?? '',
      system_prompt: char.systemPrompt ?? '',
      post_history_instructions: char.replaceGlobalNote ?? '',
      alternate_greetings: char.alternateGreetings ?? [],
      tags: char.tags ?? [],
      creator: char.additionalData?.creator ?? '',
      character_version: `${char.additionalData?.character_version ?? ''}`,
      character_book: entries.length > 0 ? {
        entries,
        scan_depth: char.loreSettings?.scanDepth,
        token_budget: char.loreSettings?.tokenBudget,
        recursive_scanning: char.loreSettings?.recursiveScanning,
      } : undefined,
      extensions: {
        risuai: {
          additionalText: char.additionalText,
          triggerscript: char.triggerscript,
          bias: char.bias,
          viewScreen: char.viewScreen,
          customScripts: char.customscript,
          utilityBot: char.utilityBot,
          sdData: char.sdData,
          backgroundHTML: char.backgroundHTML,
          license: char.license,
          largePortrait: char.largePortrait,
          lorePlus: char.lorePlus,
          inlayViewScreen: char.inlayViewScreen,
          newGenData: char.newGenData,
        },
      },
    },
  };
}

// ── 메인 API ───────────────────────────────────────────

const BACKUP_CHUNK_KEY = 'risubackup';

export interface BackupResult {
  /** 풀 캐릭터 데이터 (채팅 포함). risubackup 청크에서 복원. */
  character: any | null;
  /** 표준 chara 청크 존재 여부 (RisuAI 호환 카드) */
  hasCharaChunk: boolean;
  /** risubackup 청크 존재 여부 (플러그인 풀 백업) */
  hasFullBackup: boolean;
}

/**
 * 캐릭터 데이터를 PNG 이미지에 임베딩.
 * - `chara` tEXt: 표준 CharacterCardV2 (RisuAI 임포트 호환, 채팅 없음)
 * - `risubackup` tEXt: 전체 캐릭터 + 채팅 (gzip 압축)
 *
 * @param char - db.characters[i] 객체
 * @param pngImage - 베이스 PNG 이미지 (없으면 1x1 투명 PNG 사용)
 */
export async function createBackupPng(
  char: any,
  pngImage?: Uint8Array,
): Promise<Uint8Array> {
  const basePng = pngImage ?? PLACEHOLDER_PNG;

  // 1. 표준 chara 청크 — RisuAI가 읽을 수 있는 V2 카드
  const cardJson = JSON.stringify(buildCharaCardV2(char));
  const charaB64 = btoa(unescape(encodeURIComponent(cardJson)));
  const charaChunk = makeTEXtChunk('chara', charaB64);

  // 2. 풀 백업 청크 — 채팅 포함 전체 데이터 (gzip + base64)
  const fullJson = new TextEncoder().encode(JSON.stringify(char));
  const compressed = await gzipCompress(fullJson);
  const backupB64 = uint8ToBase64(compressed);
  const backupChunk = makeTEXtChunk(BACKUP_CHUNK_KEY, backupB64);

  // 기존 chara/risubackup 청크가 있을 수 있으므로 제거 후 삽입
  const cleaned = stripTEXtChunks(basePng, ['chara', BACKUP_CHUNK_KEY]);
  return injectTEXtChunks(cleaned, [charaChunk, backupChunk]);
}

/**
 * PNG에서 백업 데이터 추출.
 * risubackup 청크가 있으면 풀 복원, 없으면 null.
 */
export async function readBackupPng(png: Uint8Array): Promise<BackupResult> {
  const entries = parsePngTEXt(png);
  const charaEntry = entries.find(e => e.key === 'chara');
  const backupEntry = entries.find(e => e.key === BACKUP_CHUNK_KEY);

  let character: any = null;
  if (backupEntry) {
    const compressed = base64ToUint8(backupEntry.value);
    const jsonBytes = await gzipDecompress(compressed);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    character = JSON.parse(jsonStr);
  }

  return {
    character,
    hasCharaChunk: !!charaEntry,
    hasFullBackup: !!backupEntry,
  };
}

// ── 내부 헬퍼 ──────────────────────────────────────────

/** 특정 키의 tEXt 청크를 PNG에서 제거 */
function stripTEXtChunks(png: Uint8Array, keys: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(png.slice(0, 8)); // signature

  let pos = 8;
  while (pos < png.length) {
    const len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    const chunkEnd = pos + 12 + len;
    const type = new TextDecoder().decode(png.slice(pos + 4, pos + 8));

    let skip = false;
    if (type === 'tEXt') {
      const data = png.slice(pos + 8, pos + 8 + len);
      let nullIdx = 0;
      while (nullIdx < data.length && data[nullIdx] !== 0) nullIdx++;
      const key = new TextDecoder().decode(data.slice(0, nullIdx));
      if (keys.includes(key)) skip = true;
    }

    if (!skip) parts.push(png.slice(pos, chunkEnd));
    pos = chunkEnd;
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}
