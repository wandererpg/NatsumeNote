import { useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Menu, Minus, Search, Settings2, Square, X } from 'lucide-react';

export interface TitleBarProps {
  searchText?: string;
  onSearchChange?: (value: string) => void;
  showBack?: boolean;
  onBack?: () => void;
  onImport?: () => void;
  onSettingsClick?: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

const copy = {
  back: '返回游戏仓库',
  import: '导入游戏',
  settings: '\u8bbe\u7f6e',
  minimize: '\u6700\u5c0f\u5316',
  maximize: '\u6700\u5927\u5316',
  close: '\u5173\u95ed',
  searchLabel: '搜索作品或曲目',
  searchPlaceholder: '搜索作品或曲目',
};

function windowAction(name: 'minimizeWindow' | 'toggleMaximizeWindow' | 'closeWindow'): void {
  if (typeof window === 'undefined') return;
  const action = (window as unknown as { galMusic?: Record<string, () => Promise<void>> }).galMusic?.[name];
  if (action) void action().catch(() => undefined);
}

/** Frameless-window title bar with a narrow, typed window-control bridge. */
export function TitleBar({
  searchText = '',
  onSearchChange,
  showBack = false,
  onBack,
  onImport,
  onSettingsClick,
  onMinimize,
  onToggleMaximize,
  onClose,
}: TitleBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <header className="title-bar" data-testid="title-bar">
      <div className="title-bar__leading">
        {showBack && <button className="icon-button title-bar__back" type="button" aria-label={copy.back} title={copy.back} onClick={onBack}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" /></button>}
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-mark__ring" />
          <span className="brand-mark__dot" />
        </div>
        <div className="brand-lockup">
            <span className="brand-lockup__name">NatsumeNote</span>
          <span className="brand-lockup__hint">游戏原声收藏馆</span>
        </div>
      </div>

      <label className="global-search">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">{copy.searchLabel}</span>
        <input
          ref={searchRef}
          type="search"
          value={searchText}
          placeholder={copy.searchPlaceholder}
          onChange={(event) => onSearchChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && searchText) {
              event.preventDefault();
              onSearchChange?.('');
            }
          }}
          aria-label={copy.searchLabel}
          aria-keyshortcuts="Control+k Meta+k"
        />
        {searchText ? (
          <button className="icon-button global-search__clear" type="button" aria-label="清除搜索关键词" title="清除搜索关键词（Esc）" onClick={() => { onSearchChange?.(''); searchRef.current?.focus(); }}><X size={14} aria-hidden="true" /></button>
        ) : <kbd aria-hidden="true">Ctrl K</kbd>}
      </label>

      <div className="title-bar__actions">
        {onImport && <button className="title-bar__import" type="button" onClick={onImport}><Plus size={15} aria-hidden="true" />{copy.import}</button>}
        <button className="icon-button" type="button" aria-label={copy.settings} title={copy.settings} onClick={onSettingsClick}>
          <Settings2 size={17} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span className="window-control-divider" aria-hidden="true" />
        <button className="window-control" type="button" aria-label={copy.minimize} title={copy.minimize} onClick={onMinimize ?? (() => windowAction('minimizeWindow'))}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button className="window-control" type="button" aria-label={copy.maximize} title={copy.maximize} onClick={onToggleMaximize ?? (() => windowAction('toggleMaximizeWindow'))}>
          <Square size={13} aria-hidden="true" />
        </button>
        <button className="window-control window-control--close" type="button" aria-label={copy.close} title={copy.close} onClick={onClose ?? (() => windowAction('closeWindow'))}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
