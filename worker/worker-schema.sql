-- worker/schema.sql
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL
);
