CREATE TABLE IF NOT EXISTS site_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_path TEXT NOT NULL,
  episode_id TEXT NOT NULL DEFAULT '',
  episode_slug TEXT NOT NULL DEFAULT '',
  episode_title TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  player_provider TEXT NOT NULL DEFAULT '',
  playback_position_ms INTEGER NOT NULL DEFAULT 0,
  playback_duration_ms INTEGER NOT NULL DEFAULT 0,
  playback_percent REAL NOT NULL DEFAULT 0,
  platform TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT 'XX',
  zone_id TEXT NOT NULL DEFAULT 'unattributed',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_site_events_occurred_at
  ON site_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_site_events_type_occurred_at
  ON site_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_site_events_episode_occurred_at
  ON site_events (episode_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_site_events_session_occurred_at
  ON site_events (session_id, occurred_at);
