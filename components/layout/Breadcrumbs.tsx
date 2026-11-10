import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface Crumb {
  label: string
  href?: string
}

// Breadcrumb row for detail pages, e.g. Deals / Amped.
// The last item is the current page and is not a link.
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={`${item.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {i > 0 && <ChevronRight size={11} style={{ color: 'var(--text-muted)' }} />}
            {item.href && !isLast ? (
              <Link href={item.href} className="breadcrumb-link">{item.label}</Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'breadcrumb-current' : 'breadcrumb-link'}>{item.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
