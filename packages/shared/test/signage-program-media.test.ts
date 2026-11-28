import { describe, expect, it } from 'vitest';
import { isElevatorProgramMedia } from '../src/signage.js';

describe('isElevatorProgramMedia', () => {
  it('nhan doc 9:16 va ngang 16:9, tu choi 4:3 / qua nho', () => {
    expect(isElevatorProgramMedia(1080, 1920)).toBe(true);
    expect(isElevatorProgramMedia(3840, 2160)).toBe(true);
    expect(isElevatorProgramMedia(1920, 1080)).toBe(true);
    expect(isElevatorProgramMedia(324, 208)).toBe(false);
    expect(isElevatorProgramMedia(1024, 768)).toBe(false);
  });
});
