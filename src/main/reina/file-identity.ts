import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
export function fileIdentity(filePath: string): { path: string; identity: string } {
  const canonical = realpathSync(filePath);
  if (canonical.startsWith('\\\\') || canonical.startsWith('//')) throw new Error('请选择本机普通数据库文件。');
  const stat = statSync(canonical);
  if (!stat.isFile()) throw new Error('请选择本机普通数据库文件。');
  return { path: path.resolve(canonical), identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}` };
}
