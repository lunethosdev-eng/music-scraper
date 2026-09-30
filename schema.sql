-- Tabla de canciones
CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    audio_path TEXT NOT NULL,
    cover_url TEXT,
    animated_cover_url TEXT,
    lyrics JSONB DEFAULT '[]'::jsonb,
    source_platform VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Asegúrate de crear dos Buckets en Supabase Storage (públicos o privados):
-- 1. 'audio-files'
-- 2. 'covers'
