// supabase/functions/embed/index.ts
// Supabase Edge Function — generates a 384-dim embedding using the built-in
// gte-small model. Runs entirely on Supabase's infrastructure; no external
// API key needed.
//
// Deploy: supabase functions deploy embed
// Call:   supabase.functions.invoke('embed', { body: { text } })

// @ts-ignore — Supabase.ai is injected by the Edge Runtime
const session = new Supabase.ai.Session('gte-small')

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let text: string
  try {
    const body = await req.json()
    text = body?.text
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!text || typeof text !== 'string') {
    return new Response(JSON.stringify({ error: 'text (string) required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const output = await session.run(text.slice(0, 8000), {
    mean_pool: true,
    normalize: true,
  })

  return new Response(JSON.stringify({ embedding: Array.from(output) }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
