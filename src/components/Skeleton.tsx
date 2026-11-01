/** Loading placeholder: grey blocks shaped like the screen; the copy lives in the freshness strip. */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-block" key={i} />
      ))}
    </div>
  );
}
