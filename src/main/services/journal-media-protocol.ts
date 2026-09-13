import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { JOURNAL_MEDIA_PROTOCOL_SCHEME, parseJournalMediaUrl } from '../../shared/journal-media-url';
import { assertWithin } from '../../shared/paths';
import { isJournalMediaFile, journalMimeType } from './journal-assets';

export interface JournalMediaProtocolRegistrar {
  handle(scheme: string, handler: (request: { url: string; headers?: { get(name: string): string | null } }) => Response | Promise<Response>): void;
}

export interface JournalMediaProtocolOptions {
  protocol: JournalMediaProtocolRegistrar;
  fetchFile(fileUrl: string): Promise<Response>;
  getLibraryPath(): string | Promise<string>;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function registerJournalMediaProtocol(options: JournalMediaProtocolOptions): void {
  options.protocol.handle(JOURNAL_MEDIA_PROTOCOL_SCHEME, async (request) => {
    const filePath = parseJournalMediaUrl(request.url);
    if (!filePath || !path.isAbsolute(filePath) || !isJournalMediaFile(filePath)) return errorResponse(400, 'Invalid journal media path');
    const libraryPath = await options.getLibraryPath();
    if (!libraryPath.trim()) return errorResponse(403, 'Media library is not configured');
    try {
      assertWithin(filePath, libraryPath);
    } catch {
      return errorResponse(403, 'Journal media path is outside the library');
    }
    try {
      const rangeHeader = request.headers?.get('range');
      if (!rangeHeader) return await options.fetchFile(pathToFileURL(filePath).toString());
      const size = (await stat(filePath)).size;
      const range = parseRange(rangeHeader, size);
      if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const body = Readable.toWeb(createReadStream(filePath, range)) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': journalMimeType(filePath),
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    } catch {
      return errorResponse(404, 'Journal media is unavailable');
    }
  });
}
