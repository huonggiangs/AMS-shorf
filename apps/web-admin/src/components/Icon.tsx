import { ICON_PATHS } from './iconPaths';

export type IconName = keyof typeof ICON_PATHS | string;
export function Icon({ n, className = '' }: { n: IconName; className?: string }) {
  const p = ICON_PATHS[n] ?? ICON_PATHS.info!;
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {p.split(' M').map((d, i) => (
        <path key={i} d={`${i ? 'M' : ''}${d}`} />
      ))}
    </svg>
  );
}
