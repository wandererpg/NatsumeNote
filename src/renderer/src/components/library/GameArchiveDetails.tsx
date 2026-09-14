import { ExternalLink, Mic2, Sparkles, UsersRound } from 'lucide-react';

import type { GameMetadataSourceSummary } from '../../../../shared/types';

export interface GameArchiveDetailsProps {
  source: GameMetadataSourceSummary;
}

const CHARACTER_ROLES: Record<string, string> = {
  main: '主角',
  primary: '主要角色',
  side: '配角',
  appears: '登场角色',
};

const STAFF_ROLES: Record<string, string> = {
  scenario: '剧本',
  chardesign: '角色设计',
  art: '原画 / 美术',
  music: '音乐',
  songs: '歌曲',
  director: '导演',
  staff: '制作协力',
};

function roleLabel(role: string | null, labels: Record<string, string>, fallback: string): string {
  if (!role) return fallback;
  return labels[role.toLocaleLowerCase()] ?? role;
}

export function GameArchiveDetails({ source }: GameArchiveDetailsProps) {
  const characters = (source.characters ?? []).slice(0, 6);
  const staff = (source.staff ?? []).slice(0, 16);
  if (characters.length === 0 && staff.length === 0) return null;
  const provider = source.source === 'vndb' ? 'VNDB' : 'Bangumi';

  return (
    <section className="game-archive-details" aria-label="人物与制作资料">
      {characters.length > 0 && (
        <div className="game-archive-details__characters">
          <header className="game-archive-details__heading">
            <div><Sparkles size={14} aria-hidden="true" /><h3>主要人物</h3></div>
            <span>{characters.length} 位 · {provider}</span>
          </header>
          <div className="character-card-grid">
            {characters.map((character) => (
              <article className="character-card" key={character.externalId}>
                <a className="character-card__portrait" href={character.sourceUrl} target="_blank" rel="noreferrer" aria-label={`在 ${provider} 查看 ${character.name}`}>
                  <span aria-hidden="true">{character.name.slice(0, 1)}</span>
                  {character.imageUrl && <img src={character.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
                <div className="character-card__copy">
                  <span className="character-card__role">{roleLabel(character.role, CHARACTER_ROLES, '登场人物')}</span>
                  <h4>{character.name}</h4>
                  {character.originalName && character.originalName !== character.name && <small>{character.originalName}</small>}
                  {character.voiceActors.length > 0 && <span className="character-card__voice"><Mic2 size={11} aria-hidden="true" />声优 · {character.voiceActors.join('、')}</span>}
                  {character.description && <p title={character.description}>{character.description}</p>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {staff.length > 0 && (
        <aside className="game-archive-details__staff" aria-labelledby="game-staff-heading">
          <header className="game-archive-details__heading">
            <div><UsersRound size={14} aria-hidden="true" /><h3 id="game-staff-heading">主创团队</h3></div>
            <span>{provider}</span>
          </header>
          <ul className="staff-list">
            {staff.map((person, index) => (
              <li key={`${person.externalId}-${person.role}-${index}`}>
                <a href={person.sourceUrl} target="_blank" rel="noreferrer">
                  <span className="staff-list__avatar" aria-hidden="true">
                    {person.name.slice(0, 1)}
                    {person.imageUrl && <img src={person.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
                  </span>
                  <span className="staff-list__copy">
                    <small>{roleLabel(person.role, STAFF_ROLES, '主创')}</small>
                    <strong>{person.name}</strong>
                    {person.originalName && person.originalName !== person.name && <span>{person.originalName}</span>}
                  </span>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
