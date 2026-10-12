ALTER TABLE sources ADD COLUMN last_checked_at TEXT;
ALTER TABLE sources ADD COLUMN next_check_at TEXT;
ALTER TABLE sources ADD COLUMN last_error TEXT;
ALTER TABLE videos ADD COLUMN caption_attempted_at TEXT;
