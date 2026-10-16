CREATE TABLE youtube_caption_tracks (
  video_id TEXT NOT NULL REFERENCES videos(id),
  transcript_hash TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('ur','en')),
  version TEXT NOT NULL,
  source_language TEXT NOT NULL,
  provenance TEXT NOT NULL,
  cues_json TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY(video_id,transcript_hash,target,version)
);
