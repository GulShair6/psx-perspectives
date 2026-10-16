CREATE TABLE local_translation_blocks (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  transcript_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('ur','en')),
  revision TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  PRIMARY KEY(chunk_id,transcript_hash,source_hash,target,revision,version)
);
CREATE VIRTUAL TABLE english_translation_search USING fts5(text,tokenize='unicode61');
CREATE TABLE local_question_translations (
  cache_key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE research_answers (
  cache_key TEXT PRIMARY KEY,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE caption_cooldown (
  id INTEGER PRIMARY KEY CHECK(id=1),
  retry_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO caption_cooldown(id) VALUES(1);
CREATE TABLE local_reading_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  preparation_since TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO local_reading_state(id) VALUES(1);
CREATE TABLE translation_reviews (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id),
  source_hash TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('ur','en')),
  revision TEXT NOT NULL,
  version TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  audio_checked INTEGER NOT NULL CHECK(audio_checked=1),
  names INTEGER NOT NULL CHECK(names IN (0,1)),
  units INTEGER NOT NULL CHECK(units IN (0,1)),
  negation INTEGER NOT NULL CHECK(negation IN (0,1)),
  meaning INTEGER NOT NULL CHECK(meaning IN (0,1)),
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY(chunk_id,source_hash,target,revision,version)
);
