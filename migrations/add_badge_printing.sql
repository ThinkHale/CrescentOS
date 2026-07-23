-- Add badge printing support to new_starts table

-- Add photo_url column for storing associate photos
ALTER TABLE new_starts
ADD COLUMN photo_url TEXT;

-- Add badge_printed_date column to track first badge print
ALTER TABLE new_starts
ADD COLUMN badge_printed_date DATE;

-- Create Supabase Storage bucket for photos if needed
-- Note: This must be done via Supabase dashboard:
-- Storage → New Bucket → "new_start_photos" → Private
-- Add RLS policy: Allow authenticated users to upload/read their own photos

-- Example RLS policy for the bucket:
-- CREATE POLICY "Allow authenticated users to upload photos"
-- ON storage.objects FOR INSERT
-- WITH CHECK (auth.role() = 'authenticated' AND bucket_id = 'new_start_photos');

-- Example RLS policy for read:
-- CREATE POLICY "Allow public to read photos"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'new_start_photos');
