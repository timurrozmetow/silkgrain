import type { SearchSuggestResponse } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon, useFocusTrap } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { apiGet, queryString } from '../../lib/api';

/**
 * The search panel that drops from the top of the page.
 *
 * `GET /api/search/suggest` answers an empty term with the popular chips and no results, so
 * the panel is one request in both states rather than a special case for the empty field.
 *
 * The term is debounced. Without it every keystroke is a round trip, and the results flicker
 * through three wrong answers on the way to the right one.
 */
const DEBOUNCE_MS = 220;

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useFocusTrap(panelRef, { active: open, onEscape: onClose });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(term.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [term]);

  // Opening the panel puts the caret in the field, and closing it clears the term so the next
  // open does not start on someone else's search.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    setTerm('');
    setDebounced('');
    return undefined;
  }, [open]);

  const { data } = useQuery({
    queryKey: ['suggest', debounced],
    enabled: open,
    queryFn: ({ signal }) =>
      apiGet<SearchSuggestResponse>(
        `/search/suggest${queryString(debounced.length > 0 ? { q: debounced } : {})}`,
        signal,
      ),
  });

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onClose();
    void navigate({ to: '/shop', search: { q: trimmed } });
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-overlay bg-scrim transition-opacity duration-base ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-label="Search products"
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-modal w-full bg-surface shadow-panel transition-transform duration-base ease-standard ${
          open ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="mx-auto max-w-container px-gutter py-8 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(term);
            }}
          >
            <div className="flex items-center gap-4 border-b-2 border-green pb-3">
              <Icon name="magnifying-glass" size={22} className="shrink-0 text-green" />
              <input
                ref={inputRef}
                type="search"
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                }}
                placeholder="Search rice, lentils, spices…"
                aria-label="Search products"
                // 16px minimum, or iOS zooms the whole page on focus.
                className="w-full bg-transparent font-display text-[26px] text-ink outline-none placeholder:text-muted mobile:text-[18px]"
              />
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:border-green hover:text-green"
              >
                Esc
              </button>
            </div>
          </form>

          {debounced.length === 0 ? (
            <div className="mt-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                Popular right now
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {(data?.popular ?? []).map((popular) => (
                  <li key={popular}>
                    <button
                      type="button"
                      onClick={() => {
                        submit(popular);
                      }}
                      className="min-h-[36px] rounded-full border border-line bg-parchment px-4 text-[13px] text-ink transition-colors hover:border-green hover:text-green"
                    >
                      {popular}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : data === undefined ? null : data.items.length === 0 ? (
            <p className="mt-7 text-bodySm text-body-muted">
              Nothing matches &ldquo;{debounced}&rdquo;. Try a shorter word.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-line-soft">
              {data.items.map((item) => (
                <li key={item.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      void navigate({ to: '/product/$slug', params: { slug: item.slug } });
                    }}
                    className="flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-parchment"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-gold-pale">
                      {item.image === null ? (
                        <Icon name="grains" size={20} className="text-green/30" />
                      ) : (
                        <img src={item.image} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-ink">{item.name}</span>
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                        {item.categoryName}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[14px] text-ink">
                      {Money.fromCents(item.priceFromCents).format()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
