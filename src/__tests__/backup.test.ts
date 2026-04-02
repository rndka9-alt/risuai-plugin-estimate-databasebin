import { describe, it, expect } from 'vitest';
import { createBackupPng, readBackupPng, parsePngTEXt, collectAssetPaths, remapAssetPaths } from '../backup';

// ── PNG 구조 검증 ──────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  return PNG_SIGNATURE.every((b, i) => data[i] === b);
}

function findChunkTypes(png: Uint8Array): string[] {
  const types: string[] = [];
  let pos = 8;
  while (pos < png.length) {
    const len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    const type = new TextDecoder().decode(png.slice(pos + 4, pos + 8));
    types.push(type);
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return types;
}

// ── 테스트 픽스처 ──────────────────────────────────────

function makeTestCharacter(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Character',
    desc: 'A test description',
    personality: 'friendly',
    scenario: 'testing',
    firstMessage: 'Hello!',
    exampleMessage: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    alternateGreetings: [],
    tags: ['test'],
    creatorNotes: '',
    additionalData: { creator: 'tester', character_version: '1.0' },
    globalLore: [],
    loreSettings: {},
    additionalText: '',
    triggerscript: [],
    bias: [],
    viewScreen: 'none',
    customscript: [],
    utilityBot: false,
    sdData: '',
    backgroundHTML: '',
    license: '',
    largePortrait: false,
    lorePlus: false,
    inlayViewScreen: '',
    newGenData: {},
    image: '',
    chaId: 'test_char_001',
    type: 'character',
    data: { name: 'Test Character' },
    chats: [
      {
        message: [
          { role: 'char', data: 'Hello!' },
          { role: 'user', data: 'Hi there!' },
          { role: 'char', data: 'How are you?' },
        ],
        note: '',
        name: 'Chat 1',
        localLore: [],
      },
    ],
    chatPage: 0,
    ...overrides,
  };
}

// ── parsePngTEXt ───────────────────────────────────────

describe('parsePngTEXt', () => {
  it('tEXt 청크가 없는 최소 PNG에서 빈 배열 반환', () => {
    const minPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
      0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    expect(parsePngTEXt(minPng)).toEqual([]);
  });
});

// ── createBackupPng ────────────────────────────────────

describe('createBackupPng', () => {
  it('유효한 PNG 생성', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});

    expect(isPng(png)).toBe(true);
  });

  it('chara 청크와 risubackup 청크 모두 포함', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);

    const keys = entries.map(e => e.key);
    expect(keys).toContain('chara');
    expect(keys).toContain('risubackup');
  });

  it('IHDR → tEXt → IEND 순서 유지', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});
    const types = findChunkTypes(png);

    expect(types[0]).toBe('IHDR');
    expect(types[types.length - 1]).toBe('IEND');
    expect(types).toContain('tEXt');
  });

  it('chara 청크는 base64 인코딩된 JSON', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);
    const charaEntry = entries.find(e => e.key === 'chara');

    expect(charaEntry).toBeDefined();
    if (!charaEntry) return;

    // base64 디코딩 → JSON 파싱
    const json = decodeURIComponent(escape(atob(charaEntry.value)));
    const card = JSON.parse(json);

    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('Test Character');
  });

  it('커스텀 PNG 이미지를 베이스로 사용', async () => {
    const char = makeTestCharacter();

    const customPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
      0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);

    const png = await createBackupPng(char, {}, customPng);
    expect(isPng(png)).toBe(true);
    // IHDR이 보존되어야 함
    expect(findChunkTypes(png)[0]).toBe('IHDR');
  });
});

// ── readBackupPng (라운드트립) ──────────────────────────

describe('readBackupPng', () => {
  it('createBackupPng → readBackupPng 라운드트립', async () => {
    const original = makeTestCharacter();
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.hasCharaChunk).toBe(true);
    expect(result.hasFullBackup).toBe(true);
    expect(result.payload?.character).not.toBeNull();
  });

  it('캐릭터 이름 보존', async () => {
    const original = makeTestCharacter({ name: '테스트 캐릭터' });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.name).toBe('테스트 캐릭터');
  });

  it('채팅 메시지 보존', async () => {
    const original = makeTestCharacter();
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.chats).toHaveLength(1);
    expect(result.payload?.character?.chats[0].message).toHaveLength(3);
    expect(result.payload?.character?.chats[0].message[0].data).toBe('Hello!');
  });

  it('복수 채팅 세션 보존', async () => {
    const original = makeTestCharacter({
      chats: [
        { message: [{ role: 'char', data: 'First chat' }], note: '', name: 'Chat 1', localLore: [] },
        { message: [{ role: 'char', data: 'Second chat' }], note: '', name: 'Chat 2', localLore: [] },
        { message: [{ role: 'char', data: 'Third chat' }], note: '', name: 'Chat 3', localLore: [] },
      ],
    });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.chats).toHaveLength(3);
  });

  it('chaId 보존', async () => {
    const original = makeTestCharacter({ chaId: 'unique_id_12345' });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.chaId).toBe('unique_id_12345');
  });

  it('빈 채팅 캐릭터도 처리', async () => {
    const original = makeTestCharacter({ chats: [] });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.chats).toHaveLength(0);
  });

  it('그룹 캐릭터 보존', async () => {
    const original = makeTestCharacter({ type: 'group', name: 'Test Group' });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.type).toBe('group');
  });
});

// ── V2 카드 호환성 ─────────────────────────────────────

describe('V2 카드 호환성', () => {
  it('chara 청크에 spec과 data.name 포함', async () => {
    const char = makeTestCharacter({ name: 'Alice' });
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);
    const charaEntry = entries.find(e => e.key === 'chara');

    expect(charaEntry).toBeDefined();
    if (!charaEntry) return;

    const card = JSON.parse(decodeURIComponent(escape(atob(charaEntry.value))));
    expect(card.spec).toBe('chara_card_v2');
    expect(card.spec_version).toBe('2.0');
    expect(card.data).toBeDefined();
    expect(card.data.name).toBe('Alice');
  });

  it('캐릭터 설정 필드가 V2에 매핑됨', async () => {
    const char = makeTestCharacter({
      desc: 'A brave hero',
      personality: 'bold',
      scenario: 'adventure',
      firstMessage: 'Greetings!',
      systemPrompt: 'You are a hero.',
    });
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);
    const charaEntry = entries.find(e => e.key === 'chara');
    if (!charaEntry) return;

    const card = JSON.parse(decodeURIComponent(escape(atob(charaEntry.value))));
    expect(card.data.description).toBe('A brave hero');
    expect(card.data.personality).toBe('bold');
    expect(card.data.scenario).toBe('adventure');
    expect(card.data.first_mes).toBe('Greetings!');
    expect(card.data.system_prompt).toBe('You are a hero.');
  });

  it('로어북 엔트리가 character_book에 매핑됨', async () => {
    const char = makeTestCharacter({
      globalLore: [
        { key: ['dragon', 'fire'], content: 'Dragons breathe fire', comment: 'lore1', selective: false, alwaysActive: false, insertorder: 0 },
        { key: ['elf'], content: 'Elves are immortal', comment: 'lore2', selective: true, secondkey: ['immortal'], alwaysActive: true, insertorder: 1 },
      ],
    });
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);
    const charaEntry = entries.find(e => e.key === 'chara');
    if (!charaEntry) return;

    const card = JSON.parse(decodeURIComponent(escape(atob(charaEntry.value))));
    expect(card.data.character_book).toBeDefined();
    expect(card.data.character_book.entries).toHaveLength(2);
    expect(card.data.character_book.entries[0].keys).toEqual(['dragon', 'fire']);
    expect(card.data.character_book.entries[1].constant).toBe(true);
  });

  it('risuai extensions 포함', async () => {
    const char = makeTestCharacter({
      additionalText: 'extra info',
      viewScreen: 'emotion',
      license: 'MIT',
    });
    const png = await createBackupPng(char, {});
    const entries = parsePngTEXt(png);
    const charaEntry = entries.find(e => e.key === 'chara');
    if (!charaEntry) return;

    const card = JSON.parse(decodeURIComponent(escape(atob(charaEntry.value))));
    expect(card.data.extensions?.risuai?.additionalText).toBe('extra info');
    expect(card.data.extensions?.risuai?.viewScreen).toBe('emotion');
    expect(card.data.extensions?.risuai?.license).toBe('MIT');
  });
});

// ── 엣지 케이스 ────────────────────────────────────────

describe('엣지 케이스', () => {
  it('특수문자 포함 캐릭터 이름', async () => {
    const original = makeTestCharacter({ name: '캐릭터<"&>이름' });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.name).toBe('캐릭터<"&>이름');
  });

  it('이모지 포함 데이터', async () => {
    const original = makeTestCharacter({
      name: '🎭 Drama Bot',
      desc: '🌟 A dramatic character 🎪',
    });
    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.name).toBe('🎭 Drama Bot');
    expect(result.payload?.character?.desc).toBe('🌟 A dramatic character 🎪');
  });

  it('큰 채팅 데이터 처리', async () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({
      role: i % 2 === 0 ? 'char' : 'user',
      data: 'Message content #' + i + ' with some padding text '.repeat(10),
    }));
    const original = makeTestCharacter({
      chats: [{ message: messages, note: '', name: 'Big Chat', localLore: [] }],
    });

    const png = await createBackupPng(original, {});
    const result = await readBackupPng(png);

    expect(result.payload?.character?.chats[0].message).toHaveLength(500);
  });

  it('risubackup 없는 PNG에서 character가 null', async () => {
    const minPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
      0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    const result = await readBackupPng(minPng);

    expect(result.payload).toBeNull();
    expect(result.hasFullBackup).toBe(false);
    expect(result.hasCharaChunk).toBe(false);
  });
});

// ── 에셋 수집/매핑 ────────────────────────────────────

describe('collectAssetPaths', () => {
  it('image 필드 수집', () => {
    const char = makeTestCharacter({ image: 'assets/abc123' });
    expect(collectAssetPaths(char)).toContain('assets/abc123');
  });

  it('emotionImages 수집', () => {
    const char = makeTestCharacter({
      emotionImages: [['happy', 'assets/happy.png'], ['sad', 'assets/sad.png']],
    });
    const paths = collectAssetPaths(char);
    expect(paths).toContain('assets/happy.png');
    expect(paths).toContain('assets/sad.png');
  });

  it('additionalAssets 수집', () => {
    const char = makeTestCharacter({
      additionalAssets: [['bg', 'assets/bg.png', 'image']],
    });
    expect(collectAssetPaths(char)).toContain('assets/bg.png');
  });

  it('ccAssets 수집', () => {
    const char = makeTestCharacter({
      ccAssets: [{ type: 'icon', uri: 'assets/icon.png', name: 'icon', ext: 'png' }],
    });
    expect(collectAssetPaths(char)).toContain('assets/icon.png');
  });

  it('중복 경로 제거', () => {
    const char = makeTestCharacter({
      image: 'assets/same.png',
      emotionImages: [['emo', 'assets/same.png']],
    });
    const paths = collectAssetPaths(char);
    expect(paths.filter(p => p === 'assets/same.png')).toHaveLength(1);
  });

  it('빈 필드 무시', () => {
    const char = makeTestCharacter({ image: '', emotionImages: [], additionalAssets: [] });
    expect(collectAssetPaths(char)).toHaveLength(0);
  });
});

describe('remapAssetPaths', () => {
  it('image 경로 교체', () => {
    const char = makeTestCharacter({ image: 'old/path' });
    const result = remapAssetPaths(char, { 'old/path': 'new/path' });
    expect(result.image).toBe('new/path');
  });

  it('emotionImages 경로 교체', () => {
    const char = makeTestCharacter({
      emotionImages: [['happy', 'old/happy']],
    });
    const result = remapAssetPaths(char, { 'old/happy': 'new/happy' });
    expect(result.emotionImages[0][1]).toBe('new/happy');
  });

  it('원본 객체를 변경하지 않음', () => {
    const char = makeTestCharacter({ image: 'old/path' });
    remapAssetPaths(char, { 'old/path': 'new/path' });
    expect(char.image).toBe('old/path');
  });

  it('매핑에 없는 경로는 유지', () => {
    const char = makeTestCharacter({ image: 'keep/this' });
    const result = remapAssetPaths(char, {});
    expect(result.image).toBe('keep/this');
  });
});

describe('에셋 포함 라운드트립', () => {
  it('에셋이 백업 페이로드에 포함됨', async () => {
    const char = makeTestCharacter({ image: 'assets/img1' });
    const assets = { 'assets/img1': 'data:image/png;base64,abc123' };
    const png = await createBackupPng(char, assets);
    const result = await readBackupPng(png);

    expect(result.payload?.assets).toBeDefined();
    expect(result.payload?.assets['assets/img1']).toBe('data:image/png;base64,abc123');
  });

  it('빈 에셋 맵도 정상 처리', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});
    const result = await readBackupPng(png);

    expect(result.payload?.assets).toEqual({});
  });

  it('버전 2로 저장됨', async () => {
    const char = makeTestCharacter();
    const png = await createBackupPng(char, {});
    const result = await readBackupPng(png);

    expect(result.payload?.version).toBe(2);
  });
});
