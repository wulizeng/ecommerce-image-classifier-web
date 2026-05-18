-- worker/schema.sql
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    device_name TEXT DEFAULT ''
);
