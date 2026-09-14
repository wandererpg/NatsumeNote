import type { GameMetadataCharacterSummary, GameMetadataStaffSummary, MetadataSource } from '../../shared/types';
import type { MetadataHttpClient } from './game-metadata';

export interface MetadataCredits {
  characters: GameMetadataCharacterSummary[];
  staff: GameMetadataStaffSummary[];
}

const USER_AGENT = 'NatsumeNote/0.1.0';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  return string(value);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function imageUrl(value: unknown): string | null {
  const candidate = string(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function json(http: MetadataHttpClient, url: string, signal: AbortSignal, body?: Record<string, unknown>): Promise<unknown> {
  const response = await http.fetch(url, {
    method: body ? 'POST' : undefined,
    headers: body
      ? { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT }
      : { Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) throw new Error(`metadata credits request failed with status ${response.status}`);
  return response.json();
}

function vndbRole(character: Record<string, unknown>, externalId: string): string | null {
  const relations = array(character.vns).map(record).filter((relation) => id(relation.id) === externalId);
  const visible = relations.find((relation) => relation.spoiler === 0) ?? relations[0];
  return string(visible?.role);
}

function rolePriority(role: string | null): number {
  const priorities: Record<string, number> = { main: 0, 主角: 0, primary: 1, 主要角色: 1, side: 2, 配角: 2, appears: 3, 客串: 3 };
  return role ? priorities[role] ?? 4 : 5;
}

async function fetchVndbCredits(externalId: string, signal: AbortSignal, http: MetadataHttpClient): Promise<MetadataCredits> {
  const characterPayload = record(await json(http, 'https://api.vndb.org/kana/character', signal, {
    filters: ['vn', '=', ['id', '=', externalId]],
    fields: 'id,name,original,description,image.url,vns.id,vns.role,vns.spoiler',
    results: 20,
  }));
  const detailPayload = record(await json(http, 'https://api.vndb.org/kana/vn', signal, {
    filters: ['id', '=', externalId],
    fields: 'staff.id,staff.name,staff.original,staff.role,staff.note,va.staff.id,va.staff.name,va.staff.original,va.character.id',
    results: 1,
  }));
  const detail = record(array(detailPayload.results)[0]);
  const voiceByCharacter = new Map<string, string[]>();
  for (const item of array(detail.va).map(record)) {
    const characterId = id(record(item.character).id);
    const voiceName = string(record(item.staff).name);
    if (!characterId || !voiceName) continue;
    voiceByCharacter.set(characterId, [...new Set([...(voiceByCharacter.get(characterId) ?? []), voiceName])]);
  }

  const characters = array(characterPayload.results).map(record).flatMap((item) => {
    const externalCharacterId = id(item.id);
    const name = string(item.name);
    if (!externalCharacterId || !name) return [];
    return [{
      externalId: externalCharacterId,
      name,
      originalName: string(item.original),
      role: vndbRole(item, externalId),
      description: string(item.description),
      imageUrl: imageUrl(record(item.image).url),
      voiceActors: voiceByCharacter.get(externalCharacterId) ?? [],
      sourceUrl: `https://vndb.org/${externalCharacterId}`,
    }];
  }).sort((left, right) => rolePriority(left.role) - rolePriority(right.role)).slice(0, 8);

  const staff = array(detail.staff).map(record).flatMap((item) => {
    const externalStaffId = id(item.id);
    const name = string(item.name);
    const role = string(item.role);
    if (!externalStaffId || !name || !role) return [];
    return [{
      externalId: externalStaffId,
      name,
      originalName: string(item.original),
      role,
      imageUrl: null,
      sourceUrl: `https://vndb.org/${externalStaffId}`,
    }];
  }).slice(0, 20);
  return { characters, staff };
}

async function fetchBangumiCredits(externalId: string, signal: AbortSignal, http: MetadataHttpClient): Promise<MetadataCredits> {
  const [characterPayload, personPayload] = await Promise.all([
    json(http, `https://api.bgm.tv/v0/subjects/${encodeURIComponent(externalId)}/characters`, signal),
    json(http, `https://api.bgm.tv/v0/subjects/${encodeURIComponent(externalId)}/persons`, signal),
  ]);
  const characters = array(characterPayload).map(record).flatMap((item) => {
    const externalCharacterId = id(item.id);
    const name = string(item.name);
    if (!externalCharacterId || !name) return [];
    const images = record(item.images);
    return [{
      externalId: externalCharacterId,
      name,
      originalName: null,
      role: string(item.relation),
      description: string(item.summary),
      imageUrl: imageUrl(images.grid) ?? imageUrl(images.medium) ?? imageUrl(images.large),
      voiceActors: array(item.actors).map((actor) => string(record(actor).name)).filter((actor): actor is string => Boolean(actor)),
      sourceUrl: `https://bgm.tv/character/${externalCharacterId}`,
    }];
  }).sort((left, right) => rolePriority(left.role) - rolePriority(right.role)).slice(0, 8);

  const staff = array(personPayload).map(record).flatMap((item) => {
    const externalStaffId = id(item.id);
    const name = string(item.name);
    const role = string(item.relation) ?? array(item.career).map(string).filter(Boolean).join(' / ');
    if (!externalStaffId || !name || !role) return [];
    const images = record(item.images);
    return [{
      externalId: externalStaffId,
      name,
      originalName: null,
      role,
      imageUrl: imageUrl(images.grid) ?? imageUrl(images.medium),
      sourceUrl: `https://bgm.tv/person/${externalStaffId}`,
    }];
  }).slice(0, 20);
  return { characters, staff };
}

export async function fetchMetadataCredits(
  source: MetadataSource,
  externalId: string,
  signal: AbortSignal,
  http: MetadataHttpClient,
): Promise<MetadataCredits> {
  return source === 'vndb'
    ? fetchVndbCredits(externalId, signal, http)
    : fetchBangumiCredits(externalId, signal, http);
}
