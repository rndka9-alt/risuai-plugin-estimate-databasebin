import { describe, it, expect } from 'vitest';
import { envModeFromInfo } from '../render';

describe('envModeFromInfo', () => {
  it('account 동기화 → web', () => {
    expect(envModeFromInfo({ apiVersion: '3.0', platform: 'browser', saveMethod: 'account' }))
      .toBe('web');
  });

  it('node 플랫폼 → node', () => {
    expect(envModeFromInfo({ apiVersion: '3.0', platform: 'node', saveMethod: 'local' }))
      .toBe('node');
  });

  it('tauri 플랫폼 → local', () => {
    expect(envModeFromInfo({ apiVersion: '3.0', platform: 'tauri', saveMethod: 'local' }))
      .toBe('local');
  });

  it('브라우저 로컬 → local', () => {
    expect(envModeFromInfo({ apiVersion: '3.0', platform: 'browser', saveMethod: 'local' }))
      .toBe('local');
  });

  it('account + node → account가 우선 (web)', () => {
    expect(envModeFromInfo({ apiVersion: '3.0', platform: 'node', saveMethod: 'account' }))
      .toBe('web');
  });
});
