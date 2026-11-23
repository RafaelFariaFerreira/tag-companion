import type { TagState } from '@/shared/types';

interface StatusIndicatorProps {
  state: TagState;
  size?: number;
  title?: string;
}

const LABELS: Record<TagState, string> = {
  loaded: 'Carregado',
  fired: 'Disparado',
  failed: 'Falhou',
  loaded_no_fire: 'Carregou, não disparou',
};

/**
 * The four tag states, told apart by shape first and colour second:
 * - loaded: hollow ring (muted ink)
 * - fired: solid disc (success)
 * - failed: a cross (error)
 * - loaded_no_fire: dashed ring (warn)
 */
export function StatusIndicator({ state, size = 14, title }: StatusIndicatorProps) {
  const label = title ?? LABELS[state];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={`shrink-0 ${
        state === 'fired'
          ? 'text-success'
          : state === 'failed'
            ? 'text-error'
            : state === 'loaded_no_fire'
              ? 'text-warn'
              : 'text-muted'
      }`}
    >
      <title>{label}</title>
      {state === 'loaded' && (
        <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      )}
      {state === 'fired' && <circle cx="8" cy="8" r="6" fill="currentColor" />}
      {state === 'failed' && (
        <path
          d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
      {state === 'loaded_no_fire' && (
        <circle
          cx="8"
          cy="8"
          r="5.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="3 2.5"
        />
      )}
    </svg>
  );
}
