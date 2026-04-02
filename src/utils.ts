export function fmt(b: number): string {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
}

// 압축률: 양수 = 줄어듦, 음수 = 오히려 커짐 (gzip 헤더 오버헤드)
export function pct(gz: number, raw: number): string {
  return raw === 0 ? '-' : ((1 - gz / raw) * 100).toFixed(1) + '%';
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// RisuSave 블록 헤더 오버헤드: type(1) + compression(1) + nameLen(1) + name + dataLen(4)
export function blockHead(name: string): number {
  return 7 + new TextEncoder().encode(name).byteLength;
}

// gzip 압축 크기 계산 (CompressionStream 미지원 시 60% 추정)
export async function gzip(data: string | ArrayBuffer): Promise<number> {
  const buf =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (buf.byteLength === 0) return 0;

  if (typeof CompressionStream === 'undefined') {
    return Math.ceil(buf.byteLength * 0.6);
  }

  try {
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    return total;
  } catch {
    return Math.ceil(buf.byteLength * 0.6);
  }
}
