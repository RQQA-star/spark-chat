import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceMessage } from './VoiceMessage';

// jsdom 未实现媒体播放，桩掉 play/pause 避免 "Not implemented"
beforeAll(() => {
  (window.HTMLMediaElement as unknown as { prototype: { play: () => Promise<void>; pause: () => void } }).prototype.play = function () {
    return Promise.resolve();
  };
  (window.HTMLMediaElement as unknown as { prototype: { play: () => Promise<void>; pause: () => void } }).prototype.pause = function () {
    /* noop */
  };
});

describe('VoiceMessage —— 播放回调', () => {
  it('点击播放时触发 onPlayed（用于消除未读红点）', () => {
    const onPlayed = vi.fn();
    render(<VoiceMessage audioPath="a.webm" duration={3000} onPlayed={onPlayed} />);
    fireEvent.click(screen.getByTitle('播放'));
    expect(onPlayed).toHaveBeenCalledTimes(1);
  });
});
