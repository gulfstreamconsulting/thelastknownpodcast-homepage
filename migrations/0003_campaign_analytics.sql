ALTER TABLE site_events
  ADD COLUMN campaign_id TEXT NOT NULL DEFAULT 'unattributed';

CREATE INDEX IF NOT EXISTS idx_site_events_campaign_occurred_at
  ON site_events (campaign_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_site_events_campaign_session_occurred_at
  ON site_events (campaign_id, session_id, occurred_at);
