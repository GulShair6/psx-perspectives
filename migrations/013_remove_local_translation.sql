UPDATE jobs
SET status='failed', error='Local model translation has been removed.',
    progress='Local model translation has been removed.',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE type='local_translate' AND status IN ('queued','running');
