# Badge Printing Setup Guide

This guide walks through setting up the in-house badge printing system for CrescentOS.

## Overview

The badge printing system:
- Stores associate photos in Supabase Storage
- Generates CR80 portrait-format badges with photo, name, barcode, and EID
- Prints directly to your Fargo DTC1250e printer
- Automatically updates new start status from "CB Updated" → "Started" on first print

## Prerequisites

- Supabase project access (admin)
- Fargo DTC1250e printer with drivers installed
- Users with "CB Updated" or "Started" status in the New Start Tracker

## Setup Steps

### 1. Create Supabase Storage Bucket

1. Go to **Supabase Dashboard** → **Storage**
2. Click **Create a new bucket**
3. Name: `new_start_photos`
4. Keep it **Private** (public read access handled by RLS)
5. Click **Create bucket**

### 2. Set Up Row Level Security (RLS) for Storage

In the Supabase SQL Editor, run:

```sql
-- Allow authenticated users to upload photos to their own records
CREATE POLICY "Allow authenticated upload to new_start_photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND bucket_id = 'new_start_photos'
  );

-- Allow public read access to photos
CREATE POLICY "Allow public read from new_start_photos"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'new_start_photos');
```

### 3. Add Database Columns

Run the migration in Supabase SQL Editor:

```sql
-- Add photo storage and badge print tracking columns
ALTER TABLE new_starts
ADD COLUMN photo_url TEXT;

ALTER TABLE new_starts
ADD COLUMN badge_printed_date DATE;

-- Create an index for badge print tracking
CREATE INDEX idx_new_starts_badge_printed 
ON new_starts(badge_printed_date);
```

### 4. Configure Printer Access

#### For macOS/Linux (CUPS):

```bash
# List available printers
lpstat -p -d

# Set Fargo as default (if needed)
lpadmin -d "Fargo-DTC1250e"

# Test print
echo "test" | lp -d "Fargo-DTC1250e"
```

#### For Windows:

1. Add printer via **Settings → Devices → Printers & scanners**
2. Search for "Fargo DTC1250e" and install drivers
3. Set as default printer (recommended)

### 5. Enable Badge Printing in CrescentOS

The feature is now active! Here's how to use it:

#### Adding a Photo to a New Start:

1. Navigate to **New Starts** view
2. Click **+ Add applicant** or **✎** to edit existing
3. Scroll to **Associate photo** section
4. Click file input and select a photo (JPG/PNG recommended)
5. Wait for upload confirmation (green checkmark)
6. Click **Save**

#### Printing a Badge:

1. In the **New Starts** table, find the applicant
2. Status must be "CB Updated" or "Started"
3. Photo must be uploaded
4. Click **🖨️ Print** button in the Badge column
5. A preview window opens—review the badge
6. Click **🖨️ Print badge** to send to your printer
7. **Status automatically updates to "Started"** ✅
8. Badge print date is recorded

#### Subsequent Prints:

After the first badge print, the badge column shows ✓ and the print date. To print additional badges:
- Edit the applicant, click **Print Badge** in the modal
- Or use your OS print dialog to reprint from browser history

## Badge Format

CR80 card (3.375" × 2.125" @ 300 DPI):

```
┌─────────────────────────────┐
│      ProLogistix (logo)     │
│                             │
│         [PHOTO - circular]  │
│                             │
│        JOHN SMITH           │
│    PLX-21484630-SMI         │
│      Badge #21484630        │
└─────────────────────────────┘
```

### Barcode Format

`PLX-{EID (8 digits)}-{First 3 of last name}`

Example: `PLX-21484630-SMI` (for EID 21484630, last name Smith)

## Troubleshooting

### Photo Upload Fails

- **Issue:** "Error uploading photo"
- **Solution:** 
  - Check file size (max 5MB recommended)
  - Ensure file is JPG/PNG format
  - Verify Supabase Storage bucket exists and is accessible
  - Check browser console for detailed error

### Badge Preview Doesn't Show Photo

- **Issue:** Photo placeholder appears instead
- **Solution:**
  - Wait for photo to finish uploading (green checkmark required)
  - Try re-uploading the photo
  - Check that the photo URL is publicly accessible

### Print Dialog Doesn't Appear

- **Issue:** Nothing happens when clicking print
- **Solution:**
  - Check browser console for errors (F12)
  - Verify JsBarcode library loaded (check Network tab)
  - Ensure printer drivers are installed
  - Try alternative browser (Chrome/Edge recommended)

### Fargo Printer Not Responding

- **Issue:** Print job sent but nothing prints
- **Solution:**
  - Verify printer is powered on and connected
  - Update Fargo drivers to latest version
  - Test printer directly from OS print settings
  - Check print queue (remove any stuck jobs)
  - For Mac: `lpstat -o` to check queue, `cancel -a` to clear

## Technical Notes

### Libraries Used

- **JsBarcode** (CDN): Generates CODE128 barcodes for badge numbers
- **Supabase Storage**: Stores photos with auto-generated public URLs
- **Canvas API**: Client-side badge image generation

### Photo Handling

- Photos stored in Supabase Storage (`new_start_photos` bucket)
- Filenames: `{timestamp}_{originalname}` (auto-deduped)
- Public URLs are permanent and safe to share
- Delete photos via Supabase Storage dashboard if needed

### Badge Generation

- Generated on-demand as PNG in browser (no server calls)
- High resolution: 1014×638 pixels (CR80 @ 300 DPI)
- Circular photo framing with border
- CODE128 barcode (readable by standard barcode scanners)

## Future Enhancements

Possible additions:

1. **Batch printing** — Print badges for multiple associates at once
2. **Reprint history** — Log all badge prints with timestamps
3. **Badge template customization** — Different designs per shift/role
4. **Fargo API integration** — Direct printer communication (requires backend)
5. **QR code option** — Add QR to badge for digital profile lookup
6. **Badge expiration** — Track badge validity dates

## Support

For issues:

1. Check browser console (F12 → Console tab)
2. Verify all columns exist: `SELECT * FROM new_starts LIMIT 1;` in Supabase
3. Test photo upload in a new record first
4. Ensure "new_start_photos" bucket exists in Supabase Storage
