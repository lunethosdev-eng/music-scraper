-- Tablas principales
CREATE TABLE IF NOT EXISTS public.artists (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    spotify_id TEXT,
    apple_music_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album TEXT,
    duration_sec INT,
    audio_url TEXT NOT NULL,
    static_cover_url TEXT,
    animated_cover_url TEXT,
    synced_lyrics_lrc TEXT,
    source_platform TEXT DEFAULT 'youtube',
    downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(title, artist_name)
);

CREATE TABLE IF NOT EXISTS public.download_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    track_title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    search_query TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
    source_url TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.download_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    hourly_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    downloaded_count INT DEFAULT 0,
    total_bytes_mb NUMERIC DEFAULT 0
);

-- Configuración de Buckets en Storage
INSERT INTO storage.buckets (id, name, public) 
VALUES 
    ('audio-files', 'audio-files', true),
    ('cover-images', 'cover-images', true),
    ('animated-covers', 'animated-covers', true),
    ('lyrics', 'lyrics', true)
ON CONFLICT (id) DO NOTHING;

-- Polítícas de Acceso Público
CREATE POLICY "Public Read Audio" ON storage.objects FOR SELECT USING (bucket_id = 'audio-files');
CREATE POLICY "Public Read Covers" ON storage.objects FOR SELECT USING (bucket_id = 'cover-images');
CREATE POLICY "Public Read AnimCovers" ON storage.objects FOR SELECT USING (bucket_id = 'animated-covers');
CREATE POLICY "Public Read Lyrics" ON storage.objects FOR SELECT USING (bucket_id = 'lyrics');
