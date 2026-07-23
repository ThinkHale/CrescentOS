-- Add badge printing support to new_starts table

-- Add photo_url column for storing associate photos
ALTER TABLE new_starts
ADD COLUMN photo_url TEXT;

-- Add badge_printed_date column to track first badge print
ALTER TABLE new_starts
ADD COLUMN badge_printed_date DATE;

-- Create index for efficient badge print tracking queries
CREATE INDEX idx_new_starts_badge_printed
ON new_starts(badge_printed_date);

-- Storage RLS policies for photo uploads
CREATE POLICY "Allow authenticated upload to new_start_photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id = 'new_start_photos'
  );

CREATE POLICY "Allow public read from new_start_photos"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'new_start_photos');
