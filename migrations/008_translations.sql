CREATE TABLE segment_translations (
  video_id TEXT NOT NULL REFERENCES videos(id),
  transcript_hash TEXT NOT NULL,
  segment_id INTEGER NOT NULL REFERENCES caption_segments(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK(target IN ('ur','en')),
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(video_id,transcript_hash,segment_id,target,version)
);
