'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Contact } from '@/types'
import { contactTypeClass } from '@/types'
import { Plus, Search, Phone, Mail } from 'lucide-react'
import NewContactModal from '@/components/contacts/NewContactModal'

const CONTACT_TYPES = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']
const PAGE_SIZE = 100

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [showNew, setShowNew] = useState(false)
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})
  const supabase = createClient()

  useEffect(() => {
    const fetchCounts = async () => {
      const { data } = await supabase.from('contacts').select('contact_type')
      if (data) {
        const counts: Record<string, number> = {}
        data.forEach((c: any) => {
          counts[c.contact_type] = (counts[c.contact_type] || 0) + 1
        })
        setTypeCounts(counts)
        setTotal(data.length)
      }
    }
    fetchCounts()
  }, [])

  const fetchContacts = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset
    if (reset) setLoading(true)
    else setLoadingMore(true)
    let query = supabase.from('contacts').select('*').order('last_name').range(currentOffset, currentOffset + PAGE_SIZE - 1)
    if (typeFilter !== 'all') query = query.eq('contact_type', typeFilter)
    const { data } = await query
    if (data) {
      if (reset) setContacts(data)
      else setContacts(prev => [...prev, ...data])
      setOffset(currentOffset + data.length)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [supabase, typeFilter, offset])

  useEffect(() => {
    setOffset(0)
    fetchContacts(true)
  }, [typeFilter])

  useEffect(() => {
    if (!se
