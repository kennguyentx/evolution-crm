'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Deal } from '@/types'
import { formatCurrency } from '@/types'
import { BarChart3, RefreshCw, Send, TrendingUp, Activity } from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts'

const STAGE_COLORS: Record<string, string> = {
  Sourced: '#64748b', Reviewing: '#3b82f6', IOI: '#8b5cf6',
  LOI: '#f59e0b', Diligence: '#ef4444', Closing: '#10b981',
  Closed: '#059669', Pass: '#94a3b8',
}

export default function DigestPage() {
  const supabase = createClient()
  const isMobile = useIsMobile()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [digestText, setDigestText] = useState<string | null>(null)
  const [sendingToDiscord, setSendingToDiscord] = useState(false)
  const [discordSent, setDiscordSent] = useState(false)

  useEffect(() => {
    const fetchDeals = async () => {
      const { data } = await supabase.from('deals').select('*').order('updated_at', { ascending: false })
      if (data) setDeals(data)
      setLoading(false)
    }
    fetchDeals()
  }, [supabase])

  const activeDeals = deals.filter(d => d.status === 'Active')
  const closedDeals = deals.filter(d => d.status === 'Closed')
  const deadDeals = deals.filter(d => d.status === 'Dead')

  const stageData = ['Sourced','Reviewing','IOI','LOI','Diligence','Closing'].map(stage => ({
    name: stage,
    count: activeDeals.filter(d => d.stage === stage).length,
    ebitda: activeDeals.filter(d => d.stage === stage).reduce((s, d) => s + (d.ebitda || 0), 0) / 1e6,
  }))

  const recentActivity = deals
    .filter(d => new Date(d.updated_at) > subDays(new Date(), 7))
    .slice(0, 8)

  const generateDigest = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deals }),
      })
      const data = await res.json()
      setDigestText(data.digest)
    } catch (err) {
      console.error(err)
    }
    setGenerating(false)
  }

  const sendToDiscord = async () => {
    if (!digestText) return
    setSendingToDiscord(true)
    try {
      await fetch('/api/digest/send-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: digestText }),
      })
      setDiscordSent(true)
    } catch (err) {
      console.error(err)
    }
    setSendingToDiscord(false)
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>Weekly Digest</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            Week of {format(new Date(), 'MMMM d, yyyy')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-ghost" onClick={generateDigest} disabled={generating}>
            <RefreshCw size={13} className={generating ? 'spin' : ''} />
            {generating ? 'Generating...' : 'Generate Summary'}
          </button>
          {digestText && (
            <button className="btn btn-primary" onClick={sendToDiscord} disabled={sendingToDiscord || discordSent}>
              <Send size={13} />
              {discordSent ? 'Sent!' : sendingToDiscord ? 'Sending...' : 'Send to Discord'}
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px' : '24px 28px' }}>
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
          {[
            { label: 'Active Deals', value: activeDeals.length, sub: `${activeDeals.filter(d => ['LOI','Diligence','Closing'].includes(d.stage)).length} in advanced stages` },
            { label: 'Pipeline EBITDA', value: formatCurrency(activeDeals.reduce((s, d) => s + (d.ebitda || 0), 0)), sub: 'across active deals' },
            { label: 'Closed', value: closedDeals.length, sub: 'total portfolio companies' },
            { label: 'Passed', value: deadDeals.length, sub: 'dead / passed' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{label}</div>
              <div style={{ fontSize: '24px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          {/* Pipeline chart */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
              Deals by Stage
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {stageData.map(entry => (
                    <Cell key={entry.name} fill={STAGE_COLORS[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent activity */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
              Recent Activity (7 days)
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No recent activity</div>
            ) : recentActivity.map(deal => (
              <div key={deal.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>{deal.company_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{format(new Date(deal.updated_at), 'MMM d')}</div>
                </div>
                <span className={`badge stage-${deal.stage.toLowerCase()}`}>{deal.stage}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Digest */}
        {digestText && (
          <div className="card fade-in" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                AI-Generated Summary
              </div>
              <div style={{ fontSize: '11px', color: 'var(--green)' }}>● Ready to send</div>
            </div>
            <pre style={{
              fontFamily: 'var(--font-mono)', fontSize: '12px',
              color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
              lineHeight: 1.7,
            }}>
              {digestText}
            </pre>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
