ALTER TABLE translation_reviews ADD COLUMN source_kind TEXT CHECK(source_kind IN ('hindustani','hindi','english','punjabi'));
ALTER TABLE translation_reviews ADD COLUMN cases_json TEXT NOT NULL DEFAULT '[]';
