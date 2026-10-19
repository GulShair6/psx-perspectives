CREATE TABLE opinion_quarantine (
  opinion_id INTEGER PRIMARY KEY REFERENCES opinions(id),
  reason TEXT NOT NULL,
  original_payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE source_repairs (
  video_id TEXT PRIMARY KEY REFERENCES videos(id),
  previous_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- local-1 preprocessing could restore the wrong placeholder; rebuild only from current results.
DELETE FROM english_translation_search;
CREATE TRIGGER passage_delete AFTER DELETE ON passages BEGIN
  INSERT INTO passage_search(passage_search,rowid,text) VALUES('delete',old.id,old.text);
END;
CREATE TRIGGER chunk_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_search(chunk_search,rowid,searchable) VALUES('delete',old.id,old.searchable);
END;
