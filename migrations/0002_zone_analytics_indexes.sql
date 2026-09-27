CREATE INDEX IF NOT EXISTS idx_site_events_zone_occurred_at
  ON site_events (zone_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_site_events_zone_session_occurred_at
  ON site_events (zone_id, session_id, occurred_at);
