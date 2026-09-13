import { describe, expect, it } from 'vitest';

import {
  addJournalBlock,
  createBlankJournalPage,
  createJournalDetailsBlock,
  createJournalTextBlock,
  expandJournalCanvas,
  moveJournalBlock,
  removeJournalBlock,
  resizeJournalBlock,
  updateJournalBlock,
} from '../../src/renderer/src/features/journal/journal-model';
import { commitJournalHistory, createJournalHistory, redoJournalHistory, undoJournalHistory } from '../../src/renderer/src/features/journal/journal-history';
import { journalPageToSvg } from '../../src/renderer/src/features/journal/journal-export';
import type { JournalPage } from '../../src/shared/types';

function pageFixture(): JournalPage {
  return createBlankJournalPage('game-1', 'page-1', '第一页');
}

describe('journal page model', () => {
  it('creates, updates, moves, resizes and removes blocks without mutating the source page', () => {
    const page = pageFixture();
    const textBlock = createJournalTextBlock('text-1', 40, 60);
    const added = addJournalBlock(page, textBlock);

    expect(page.blocks).toHaveLength(0);
    expect(added.blocks[0]).toMatchObject({
      id: 'text-1', x: 40, y: 60, width: 240, height: 210,
      backgroundColor: '#fff2a8', fontSize: 18, zIndex: 0,
    });

    const edited = updateJournalBlock(added, 'text-1', { text: '一段新的记录', fontSize: 28 });
    expect(edited.blocks[0]).toMatchObject({ text: '一段新的记录', fontSize: 28 });

    const moved = moveJournalBlock(edited, 'text-1', 160, 120);
    expect(moved.blocks[0]).toMatchObject({ x: 200, y: 180 });

    const resized = resizeJournalBlock(moved, 'text-1', 520, 260);
    expect(resized.blocks[0]).toMatchObject({ width: 520, height: 260 });
    expect(removeJournalBlock(resized, 'text-1').blocks).toHaveLength(0);
  });

  it('expands the canvas when a block would go past the current edge', () => {
    const page = pageFixture();
    const block = createJournalDetailsBlock('details-1', 900, 620);
    const next = addJournalBlock(page, block);

    expect(next.canvasWidth).toBeGreaterThanOrEqual(900 + block.width);
    expect(next.canvasHeight).toBeGreaterThanOrEqual(620 + block.height);
    expect(expandJournalCanvas(page, 'width').canvasWidth).toBe(page.canvasWidth + 320);
  });

  it('keeps undo and redo branches deterministic', () => {
    const initial = pageFixture();
    const first = addJournalBlock(initial, createJournalTextBlock('text-1', 0, 0));
    const second = updateJournalBlock(first, 'text-1', { text: '第二版' });
    const afterFirst = commitJournalHistory(createJournalHistory(initial), first);
    const afterSecond = commitJournalHistory(afterFirst, second);

    expect(undoJournalHistory(afterSecond).present.blocks[0]).toMatchObject({ text: '' });
    expect(redoJournalHistory(undoJournalHistory(afterSecond)).present.blocks[0]).toMatchObject({ text: '第二版' });
  });
});

describe('journal export', () => {
  it('renders a safe SVG snapshot without legacy work-detail blocks', () => {
    const page = addJournalBlock(
      addJournalBlock(pageFixture(), createJournalTextBlock('text-1', 30, 40)),
      createJournalDetailsBlock('details-1', 480, 40),
    );
    const svg = journalPageToSvg(page, {
      gameName: 'ATRI & <memory>',
      metadata: { gameId: 'game-1', coverSource: null, sources: [] },
      tracks: [],
      assets: [],
    });

    expect(svg).toContain('ATRI &amp; &lt;memory&gt;');
    expect(svg).not.toContain('作品详情');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});
