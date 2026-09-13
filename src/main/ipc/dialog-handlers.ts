import { AppError } from '../../shared/errors';
import {
  IPC_DIALOG_SELECT_FILES,
  IPC_DIALOG_SELECT_FOLDER,
  IPC_DIALOG_SELECT_IMAGE,
  IPC_JOURNAL_SELECT_MEDIA,
  IPC_SHELL_OPEN_EXPLORER,
} from '../../shared/ipc';
import {
  assertArgumentCount,
  assertPath,
  assertString,
} from './validation';
import type { IpcMainLike } from './library-handlers';
import type { JournalAsset, JournalAssetKind } from '../../shared/types';

export interface DialogLike {
  showOpenDialog(
    browserWindow: unknown,
    options: { properties: string[]; filters?: Array<{ name: string; extensions: string[] }> },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ShellLike {
  openPath(targetPath: string): Promise<string>;
}

export interface DialogHandlerDependencies {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  shell: ShellLike;
  getOwnerWindow?: (event: unknown) => unknown;
  onImageSelected?: (filePath: string) => void;
  onJournalMediaSelected?: (gameId: string, kind: JournalAssetKind, filePaths: string[]) => Promise<JournalAsset[]> | JournalAsset[];
}

function ownerWindow(event: unknown, getOwnerWindow?: (event: unknown) => unknown): unknown {
  if (getOwnerWindow) {
    return getOwnerWindow(event);
  }
  const sender = (event as { sender?: { getOwnerBrowserWindow?: () => unknown } }).sender;
  return sender?.getOwnerBrowserWindow?.();
}

export function registerDialogHandlers({
  ipcMain,
  dialog,
  shell,
  getOwnerWindow,
  onImageSelected,
  onJournalMediaSelected,
}: DialogHandlerDependencies): void {
  ipcMain.handle(IPC_DIALOG_SELECT_FOLDER, async (event, ...args) => {
    assertArgumentCount(args, 0, IPC_DIALOG_SELECT_FOLDER);
    const result = await dialog.showOpenDialog(ownerWindow(event, getOwnerWindow), {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_DIALOG_SELECT_FILES, async (event, ...args) => {
    assertArgumentCount(args, 0, IPC_DIALOG_SELECT_FILES);
    const result = await dialog.showOpenDialog(ownerWindow(event, getOwnerWindow), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['ogg', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'opus', 'wma', 'owp'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC_DIALOG_SELECT_IMAGE, async (event, ...args) => {
    assertArgumentCount(args, 0, IPC_DIALOG_SELECT_IMAGE);
    const result = await dialog.showOpenDialog(ownerWindow(event, getOwnerWindow), {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    if (selected) onImageSelected?.(selected);
    return selected;
  });

  ipcMain.handle(IPC_JOURNAL_SELECT_MEDIA, async (event, ...args) => {
    assertArgumentCount(args, 2, IPC_JOURNAL_SELECT_MEDIA);
    assertString(args[0], 'gameId');
    if (args[1] !== 'image' && args[1] !== 'video') {
      throw new AppError('DB_ERROR', `Invalid journal media kind: ${String(args[1])}`, '不支持这种手账素材。');
    }
    if (!onJournalMediaSelected) {
      throw new AppError('DB_ERROR', 'Journal media importer is not configured', '手账素材导入暂不可用。');
    }
    const kind = args[1] as JournalAssetKind;
    const filters = kind === 'image'
      ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogv', 'mov'] }];
    const result = await dialog.showOpenDialog(ownerWindow(event, getOwnerWindow), {
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return await onJournalMediaSelected(args[0], kind, result.filePaths);
  });

  ipcMain.handle(IPC_SHELL_OPEN_EXPLORER, async (_event, ...args) => {
    assertArgumentCount(args, 1, IPC_SHELL_OPEN_EXPLORER);
    assertPath(args[0], 'targetPath');
    const errorMessage = await shell.openPath(args[0]);
    if (errorMessage) {
      throw new AppError('PERMISSION_DENIED', errorMessage, '无法打开文件所在位置。');
    }
  });
}

export default registerDialogHandlers;
