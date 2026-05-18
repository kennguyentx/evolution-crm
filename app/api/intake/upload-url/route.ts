import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'intake-temp'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const { fileName } = await req.json()
    const supabase = serviceClient()

    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets()
    if (!buckets?.find(b => b.name === BUCKET)) {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: false })
      if (error && !error.message.includes('already exists')) {
        throw new Error(`Bucket creation failed: ${error.message}`)
      }
    }

    const storagePath = `${Date.now()}-${fileName}`

    // Signed URL for the client to PUT the file directly to Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath)

    if (error) throw new Error(error.message)

    return NextResponse.json({ signedUploadUrl: data.signedUrl, storagePath })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
