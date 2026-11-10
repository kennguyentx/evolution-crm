// Shared skeleton shown by loading.tsx files while a heavy page's
// segment loads. Pages fetch their data client-side, so this is the
// instant feedback on navigation (item 25) — not a data placeholder.
export default function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ width: '220px', height: '28px' }} />
      <div className="skeleton" style={{ width: '100%', height: '44px' }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: '100%', height: '56px' }} />
      ))}
    </div>
  )
}
