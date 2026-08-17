import { describe, it, expect } from 'vitest';
import { isDangerous, isSystemPath } from './remoteAssistSafety';

describe('isSystemPath', () => {
  it('识别 Windows 系统目录', () => {
    expect(isSystemPath('C:\\Windows\\system32\\foo.dll')).toBe(true);
    expect(isSystemPath('C:/windows/explorer.exe')).toBe(true);
    expect(isSystemPath('SysWOW64\\x.dll')).toBe(true);
  });
  it('识别类 Unix 系统路径', () => {
    expect(isSystemPath('/etc/passwd')).toBe(true);
    expect(isSystemPath('/usr/bin/app')).toBe(true);
    expect(isSystemPath('bootmgr')).toBe(true);
  });
  it('用户目录下的文件不算系统路径', () => {
    expect(isSystemPath('C:\\Users\\me\\config.json')).toBe(false);
    expect(isSystemPath('/home/me/.bashrc')).toBe(false);
    expect(isSystemPath('D:\\projects\\app\\main.js')).toBe(false);
  });
});

describe('isDangerous', () => {
  it('危险删除/格式化/关机命令被判定为危险', () => {
    expect(isDangerous({ action: 'run_command', params: { command: 'rm -rf /' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'rm -fr ./node_modules' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'rmdir /s build' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'del /f secrets.txt' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'format c:' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'shutdown /s /t 0' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'sudo rm x' } })).toBe(true);
    expect(isDangerous({ action: 'run_command', params: { command: 'dd if=/dev/zero of=/dev/sda' } })).toBe(true);
  });

  it('普通命令安全', () => {
    expect(isDangerous({ action: 'run_command', params: { command: 'ls -la' } })).toBe(false);
    expect(isDangerous({ action: 'run_command', params: { command: 'npm install' } })).toBe(false);
    expect(isDangerous({ action: 'run_command', params: { command: 'cat package.json' } })).toBe(false);
    expect(isDangerous({ action: 'run_command', params: { command: 'echo hello' } })).toBe(false);
  });

  it('写入系统目录被判定为危险', () => {
    expect(isDangerous({ action: 'write_file', params: { path: 'C:\\Windows\\system32\\x.dll', content: 'x' } })).toBe(true);
    expect(isDangerous({ action: 'write_file', params: { path: '/etc/passwd', content: 'x' } })).toBe(true);
  });

  it('写入用户目录安全', () => {
    expect(isDangerous({ action: 'write_file', params: { path: 'C:\\Users\\me\\.sparkrc', content: 'x' } })).toBe(false);
  });

  it('读取文件不算危险', () => {
    expect(isDangerous({ action: 'read_file', params: { path: '/etc/passwd' } })).toBe(false);
  });
});
