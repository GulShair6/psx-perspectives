ALTER TABLE chunks ADD COLUMN metadata_indexed INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER chunk_update AFTER UPDATE OF searchable ON chunks BEGIN
  INSERT INTO chunk_search(chunk_search,rowid,searchable) VALUES('delete',old.id,old.searchable);
  INSERT INTO chunk_search(rowid,searchable) VALUES(new.id,new.searchable);
END;
