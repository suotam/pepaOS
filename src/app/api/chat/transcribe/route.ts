import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

export async function POST(request: NextRequest) {
  try {
    if (!openai) {
      return NextResponse.json({ error: 'OpenAI key not configured.' }, { status: 500 })
    }

    const formData = await request.formData()
    const audio = formData.get('audio')

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'Audio file is required.' }, { status: 400 })
    }

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: 'cs',
    })

    return NextResponse.json({ text: transcription.text || '' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voice transcription failed.' },
      { status: 500 }
    )
  }
}
