/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SummaryReader } from '../../src/renderer/src/components/library/SummaryReader';

const source = '[From [url=https://sekaiproject.com/portfolio-item/amatsutsumi/]Sekai Project[/url]]';

describe('SummaryReader display text', () => {
  afterEach(() => cleanup());

  it('removes the complete publisher source marker while retaining story paragraphs', () => {
    const story = 'A boy leaves his isolated village.\n\nHe meets a girl who changes his life.';
    const original = `${story}\n\n${source}`;
    render(<SummaryReader original={original} translated={null} />);

    const text = screen.getByRole('region', { name: '简介正文' });
    expect(text.querySelector('p')?.textContent).toBe(story);
    expect(text).not.toHaveTextContent('Sekai Project');
    expect(text).not.toHaveTextContent('sekaiproject.com');
    expect(text).not.toHaveTextContent('[From');
    expect(original).toBe(`${story}\n\n${source}`);
  });

  it('keeps link labels, story brackets and prose while removing recognized BBCode', () => {
    const original = 'From now on, [b]Makoto[/b] follows [url=https://example.com/story]his own path[/url].\n'
      + '[From the forgotten island] remains the title of his [i]first memory[/i].\n'
      + '[spoiler]A [color=#fff]secret[/color] waits.[/spoiler] [SAVE]';
    render(<SummaryReader original={original} translated={null} />);

    const text = screen.getByRole('region', { name: '简介正文' });
    expect(text.querySelector('p')?.textContent).toBe('From now on, Makoto follows his own path.\n'
      + '[From the forgotten island] remains the title of his first memory.\n'
      + 'A secret waits. [SAVE]');
    expect(text).not.toHaveTextContent('https://example.com');
    expect(text.querySelector('a')).toBeNull();
  });

  it('cleans case-insensitive source markers and line-break BBCode without losing text', () => {
    const original = 'The first meeting.[br]The next morning.\n\n'
      + '[FROM [URL="https://example.com"]Publisher [b]Name[/b][/URL]]';
    render(<SummaryReader original={original} translated={null} />);

    expect(screen.getByRole('region', { name: '简介正文' }).querySelector('p')?.textContent)
      .toBe('The first meeting.\nThe next morning.');
  });

  it('preserves linked From titles in prose and does not match across separate links', () => {
    const original = 'A letter titled [From [url=https://example.com/father]Father[/url]] changes everything.\n'
      + '[From [url=https://example.com/village]a village[/url] to the city] begins her journey.\n'
      + 'She finds [[url=https://example.com/letter]a letter[/url]].';
    render(<SummaryReader original={original} translated={null} />);
    expect(screen.getByRole('region', { name: '简介正文' }).querySelector('p')?.textContent)
      .toBe('A letter titled [From Father] changes everything.\n'
        + '[From a village to the city] begins her journey.\nShe finds [a letter].');
  });

  it('renders untrusted markup as text and never creates HTML or clickable URLs', () => {
    const original = '<img src=x onerror="alert(1)"><script>alert(2)</script> '
      + '[url=javascript:alert(3)]Continue the story[/url]';
    render(<SummaryReader original={original} translated={null} />);

    const text = screen.getByRole('region', { name: '简介正文' });
    expect(text.querySelector('p')?.textContent)
      .toBe('<img src=x onerror="alert(1)"><script>alert(2)</script> Continue the story');
    expect(text.querySelector('img, script, a')).toBeNull();
  });

  it('places both language blocks in one keyboard-focusable region with controls outside it', () => {
    render(<SummaryReader original={`The story begins.\n\n${source}`} translated={`故事开始了。\n\n${source}`} />);
    fireEvent.click(screen.getByRole('button', { name: '中文与原文双语对照' }));

    const text = screen.getByRole('region', { name: '简介正文' });
    expect(text).toHaveClass('summary-reader__scroll');
    expect(text).toHaveAttribute('tabindex', '0');
    expect(within(text).getByText('The story begins.')).toBeInTheDocument();
    expect(within(text).getByText('故事开始了。')).toBeInTheDocument();
    expect(text.querySelectorAll('.summary-reader__text')).toHaveLength(2);
    expect(text).not.toContainElement(screen.getByRole('group', { name: '简介语言' }));
    expect(text).not.toHaveTextContent('Sekai Project');

    fireEvent.click(screen.getByRole('button', { name: '仅显示原文' }));
    expect(within(text).queryByText('故事开始了。')).not.toBeInTheDocument();
    expect(within(text).getByText('The story begins.')).toBeInTheDocument();
  });

  it('also cleans a newly fetched translation while retaining the bilingual controls', async () => {
    const onTranslate = vi.fn().mockResolvedValue(`[b]故事开始了。[/b]\n\n${source}`);
    render(<SummaryReader original={`The story begins.\n\n${source}`} translated={null} onTranslate={onTranslate} />);
    fireEvent.click(screen.getByRole('button', { name: '翻译为中文' }));

    await waitFor(() => expect(onTranslate).toHaveBeenCalledOnce());
    const text = screen.getByRole('region', { name: '简介正文' });
    expect(await within(text).findByText('故事开始了。')).toBeInTheDocument();
    expect(within(text).getByText('The story begins.')).toBeInTheDocument();
    expect(text).not.toHaveTextContent('Sekai Project');
    expect(screen.getByRole('button', { name: '中文与原文双语对照' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the readable story to detect Chinese instead of the English source URL', () => {
    render(<SummaryReader original={`这是一段关于夏天与回忆的中文剧情简介。\n\n${source}`} translated={null} onTranslate={vi.fn()} />);

    expect(screen.getByRole('region', { name: '简介正文' })).toHaveTextContent('这是一段关于夏天与回忆的中文剧情简介。');
    expect(screen.queryByRole('button', { name: '翻译为中文' })).not.toBeInTheDocument();
  });
});
