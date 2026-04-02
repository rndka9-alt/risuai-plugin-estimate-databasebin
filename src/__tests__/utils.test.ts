import { describe, it, expect } from 'vitest';
import { fmt, pct, esc, blockHead, gzip } from '../utils';

describe('fmt', () => {
  it('0 바이트', () => {
    expect(fmt(0)).toBe('0 B');
  });

  it('바이트 단위', () => {
    expect(fmt(500)).toBe('500.00 B');
  });

  it('KB 단위', () => {
    expect(fmt(1024)).toBe('1.00 KB');
    expect(fmt(1536)).toBe('1.50 KB');
  });

  it('MB 단위', () => {
    expect(fmt(1048576)).toBe('1.00 MB');
  });

  it('GB 단위', () => {
    expect(fmt(1073741824)).toBe('1.00 GB');
  });
});

describe('pct', () => {
  it('raw가 0이면 - 반환', () => {
    expect(pct(0, 0)).toBe('-');
  });

  it('50% 압축률', () => {
    expect(pct(50, 100)).toBe('50.0%');
  });

  it('압축 안 됨 (0%)', () => {
    expect(pct(100, 100)).toBe('0.0%');
  });

  it('음수 압축률 (오히려 커짐)', () => {
    const result = pct(120, 100);
    expect(result).toBe('-20.0%');
  });
});

describe('esc', () => {
  it('HTML 특수문자 이스케이프', () => {
    expect(esc('<script>"hello"&</script>')).toBe(
      '&lt;script&gt;&quot;hello&quot;&amp;&lt;/script&gt;'
    );
  });

  it('일반 문자열은 그대로', () => {
    expect(esc('hello world')).toBe('hello world');
  });
});

describe('blockHead', () => {
  it('ASCII 이름의 헤더 크기', () => {
    // 7 (고정 오버헤드) + name 바이트 길이
    expect(blockHead('root')).toBe(7 + 4);
    expect(blockHead('config')).toBe(7 + 6);
  });

  it('빈 이름', () => {
    expect(blockHead('')).toBe(7);
  });

  it('한글 이름 (UTF-8 멀티바이트)', () => {
    // '가' = 3 bytes in UTF-8
    expect(blockHead('가')).toBe(7 + 3);
  });
});

describe('gzip', () => {
  it('빈 데이터는 0 반환', async () => {
    expect(await gzip('')).toBe(0);
  });

  it('문자열 압축 후 크기가 양수', async () => {
    const result = await gzip('hello world'.repeat(100));
    expect(result).toBeGreaterThan(0);
  });

  it('반복 데이터는 원본보다 작게 압축됨', async () => {
    const input = 'abcdef'.repeat(1000);
    const rawSize = new TextEncoder().encode(input).byteLength;
    const gzSize = await gzip(input);
    expect(gzSize).toBeLessThan(rawSize);
  });

  it('ArrayBuffer 입력도 처리', async () => {
    const buf = new TextEncoder().encode('test data').buffer;
    const result = await gzip(buf);
    expect(result).toBeGreaterThan(0);
  });
});
