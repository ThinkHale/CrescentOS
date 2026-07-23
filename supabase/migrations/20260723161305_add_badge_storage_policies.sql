-- Add RLS policies for badge photo storage bucket

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
