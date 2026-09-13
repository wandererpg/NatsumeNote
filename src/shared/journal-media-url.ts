/** Protocol used to expose managed scrapbook images and videos to the renderer. */
export const JOURNAL_MEDIA_PROTOCOL_SCHEME = 'galmusic-journal-media';

export function toJournalMediaUrl(filePath: string): string {
  if (filePath.toLowerCase().startsWith(`${JOURNAL_MEDIA_PROTOCOL_SCHEME}:`)) return filePath;
  return `${JOURNAL_MEDIA_PROTOCOL_SCHEME}://local?path=${encodeURIComponent(filePath)}`;
}

export function parseJournalMediaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${JOURNAL_MEDIA_PROTOCOL_SCHEME}:`) return null;
    return url.searchParams.get('path')?.trim() || null;
  } catch {
    return null;
  }
}
