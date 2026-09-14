import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceFiles = [
  'src/renderer/src/App.tsx',
  'src/renderer/src/components/library/GameShelf.tsx',
  'src/renderer/src/components/library/GameEditor.tsx',
  'src/renderer/src/features/journal/JournalWorkspace.tsx',
];

const removedCopy = [
  '从一部作品开始，回到它的音乐与记忆。',
  '独立作品手账',
  '重命名会同步更新音乐库中的文件夹和曲目路径。',
  '将永久删除这个作品、库内曲目和已复制的音乐文件。',
  '导入音乐后自动抓取并缓存 VNDB 与 Bangumi 资料',
  '作品资料会在导入后自动抓取；白板只保留自由创作内容。',
  '今天想把这部作品记下来。',
  '可以在这里写下感想、喜欢的场景，或任何想留下的声音。',
];

describe('concise renderer copy', () => {
  it('does not include the removed explanatory phrases', async () => {
    const source = (await Promise.all(sourceFiles.map((file) => readFile(path.resolve(file), 'utf8')))).join('\n');
    removedCopy.forEach((copy) => expect(source).not.toContain(copy));
  });
});
