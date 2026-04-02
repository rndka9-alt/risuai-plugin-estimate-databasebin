import { describe, it, expect } from 'vitest';
import { analyze } from '../analyze';

// gzip이 CompressionStream을 쓰므로 Node 18+ 필요
// 테스트 환경에서 미지원 시 60% 추정 fallback 사용

function mockDb(characters: any[] = []) {
  return { characters } as any;
}

const info = { apiVersion: '3.0', platform: 'test', saveMethod: 'local' };
const noop = () => {};

describe('analyze — CharInfo.breakdown', () => {
  it('채팅이 있는 캐릭터의 breakdown.chats > 0', async () => {
    const db = mockDb([{
      chaId: 'c1',
      data: { name: 'Alice' },
      chats: [{ message: [{ role: 'user', content: 'hello' }] }],
    }]);
    const r = await analyze(db, info, noop);
    expect(r.chars).toHaveLength(1);
    expect(r.chars[0].breakdown.chats).toBeGreaterThan(0);
  });

  it('로어북이 있는 캐릭터의 breakdown.lorebook > 0', async () => {
    const db = mockDb([{
      chaId: 'c2',
      data: {
        name: 'Bob',
        globalLore: [{ key: ['greeting'], content: 'Hello!' }],
      },
      chats: [],
    }]);
    const r = await analyze(db, info, noop);
    expect(r.chars[0].breakdown.lorebook).toBeGreaterThan(0);
  });

  it('이미지가 있는 캐릭터의 breakdown.assets > 0', async () => {
    const db = mockDb([{
      chaId: 'c3',
      data: { name: 'Carol' },
      image: 'data:image/png;base64,iVBORw0KGgo=',
      emotionImages: [['happy', 'data:image/png;base64,abc']],
      chats: [],
    }]);
    const r = await analyze(db, info, noop);
    expect(r.chars[0].breakdown.assets).toBeGreaterThan(0);
  });

  it('채팅·로어북·에셋이 없는 캐릭터는 other에 집중', async () => {
    const db = mockDb([{
      chaId: 'c4',
      data: { name: 'Dave' },
    }]);
    const r = await analyze(db, info, noop);
    const bd = r.chars[0].breakdown;
    expect(bd.chats).toBe(0);
    expect(bd.lorebook).toBe(0);
    expect(bd.assets).toBe(0);
    // data, chaId 등이 other에 포함
    expect(bd.other).toBeGreaterThan(0);
  });

  it('breakdown 합산이 raw 크기(헤더 제외)와 일치', async () => {
    const db = mockDb([{
      chaId: 'c5',
      data: {
        name: 'Eve',
        globalLore: [{ key: ['a'], content: 'lore text' }],
        additionalAssets: [['icon', 'data:base64stuff', 'image']],
      },
      image: 'base64imagedata',
      chats: [{ message: [{ role: 'user', content: 'hi' }] }],
    }]);
    const r = await analyze(db, info, noop);
    const c = r.chars[0];
    const bd = c.breakdown;
    const headerSize = 7 + new TextEncoder().encode('c5').byteLength;
    // breakdown 합산 = raw - 블록 헤더 오버헤드
    expect(bd.chats + bd.lorebook + bd.assets + bd.other).toBe(c.raw - headerSize);
  });

  it('remoteRefSize가 REMOTE 참조 블록 크기를 반영', async () => {
    const db = mockDb([{
      chaId: 'test-char-id',
      data: { name: 'Test' },
      chats: [],
    }]);
    const r = await analyze(db, info, noop);
    const c = r.chars[0];
    const refJson = JSON.stringify({ v: 1, type: 2, name: 'test-char-id' });
    const enc = new TextEncoder();
    const expected = enc.encode(refJson).byteLength + 7 + enc.encode('test-char-id').byteLength;
    expect(c.remoteRefSize).toBe(expected);
    expect(c.remoteRefSize).toBeLessThan(c.raw);
  });

  it('오류 발생 시 breakdown은 전부 0', async () => {
    // JSON.stringify가 실패하도록 순환 참조 생성
    const circular: any = { chaId: 'bad', chats: [] };
    circular.self = circular;
    const db = mockDb([circular]);
    const r = await analyze(db, info, noop);
    expect(r.chars[0].name).toMatch(/오류/);
    const bd = r.chars[0].breakdown;
    expect(bd.chats + bd.lorebook + bd.assets + bd.other).toBe(0);
    expect(r.chars[0].remoteRefSize).toBe(0);
  });
});
