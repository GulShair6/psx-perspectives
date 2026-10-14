-- Legacy grouped transcripts did not retain an import time; do not invent one during indexing.
UPDATE caption_segments SET retrieved_at=COALESCE((SELECT caption_attempted_at FROM videos WHERE videos.id=caption_segments.video_id),'') WHERE provenance='legacy import';
