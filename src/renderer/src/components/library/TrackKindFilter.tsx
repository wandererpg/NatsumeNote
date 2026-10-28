import type { TrackKind } from '../../../../shared/types';

const options = [[null, '全部'], ['music', '音乐'], ['voice', '语音']] as const;

export function TrackKindFilter({ value, onChange }: {
  value: TrackKind | null;
  onChange: (value: TrackKind | null) => void;
}) {
  const index = options.findIndex(([kind]) => kind === value);
  return (
    <div className="track-kind-filter" role="group" aria-label="曲目分类">
      <span className="track-kind-filter__selection" aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map(([kind, label]) => (
        <button key={label} type="button" aria-pressed={value === kind}
          className={value === kind ? 'is-active' : ''}
          onClick={() => onChange(kind)}>{label}</button>
      ))}
    </div>
  );
}
