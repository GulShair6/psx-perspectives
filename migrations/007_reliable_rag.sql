ALTER TABLE channel_checkpoints ADD COLUMN history_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE statements ADD COLUMN analysis_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE statements ADD COLUMN transcript_hash TEXT;
UPDATE statements SET transcript_hash=(SELECT content_hash FROM videos WHERE videos.id=statements.video_id);
CREATE INDEX statement_stock_lookup ON statement_stocks(symbol,statement_id);
CREATE INDEX statement_topic_lookup ON statement_topics(topic,statement_id);
CREATE INDEX statement_chunk_version ON statements(chunk_id,analysis_version,transcript_hash);
CREATE TABLE query_plans(cache_key TEXT PRIMARY KEY,plan TEXT NOT NULL,created_at TEXT NOT NULL);
