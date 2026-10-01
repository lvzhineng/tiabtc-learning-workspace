"""SQLite tables for the current workspace features."""

WORKSPACE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_candles (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
);
CREATE TABLE IF NOT EXISTS market_cache_ranges (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, interval, start_timestamp, end_timestamp)
);
CREATE TABLE IF NOT EXISTS cfd_candles (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
);
CREATE TABLE IF NOT EXISTS cfd_cache_ranges (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER NOT NULL,
    fetched_at REAL NOT NULL,
    PRIMARY KEY (symbol, interval, start_timestamp, end_timestamp)
);
CREATE TABLE IF NOT EXISTS cfd_drawings (
    symbol TEXT NOT NULL,
    id TEXT NOT NULL,
    interval TEXT NOT NULL,
    tool_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, id)
);
CREATE TABLE IF NOT EXISTS chart_drawings (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    tool_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_symbols (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL NOT NULL,
    tp_price REAL NOT NULL,
    sl_price REAL NOT NULL,
    rr_ratio REAL NOT NULL,
    status TEXT NOT NULL,
    pnl_r REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at TEXT
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('offline_mode', 'true');
CREATE TABLE IF NOT EXISTS exchange_positions (
    venue TEXT NOT NULL,
    position_id TEXT NOT NULL,
    unified_symbol TEXT NOT NULL,
    chart_symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    status TEXT NOT NULL,
    entry_price REAL,
    exit_price REAL,
    contracts REAL,
    leverage REAL,
    margin_mode TEXT,
    hedged INTEGER NOT NULL DEFAULT 0,
    realized_pnl REAL,
    net_pnl REAL,
    funding REAL,
    open_fee REAL,
    close_fee REAL,
    entry_time_ms INTEGER NOT NULL,
    exit_time_ms INTEGER,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (venue, position_id)
);
CREATE TABLE IF NOT EXISTS position_notes (
    venue TEXT NOT NULL,
    position_id TEXT NOT NULL,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (venue, position_id)
);
CREATE TABLE IF NOT EXISTS position_drawings (
    venue TEXT NOT NULL,
    position_id TEXT NOT NULL,
    id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    tool_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (venue, position_id, id)
);
CREATE INDEX IF NOT EXISTS idx_position_drawings_scope
    ON position_drawings (venue, position_id, created_at);
CREATE TABLE IF NOT EXISTS position_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS position_tag_map (
    venue TEXT NOT NULL,
    position_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (venue, position_id, tag_id),
    FOREIGN KEY (tag_id) REFERENCES position_tags(id)
);
CREATE TABLE IF NOT EXISTS position_fills (
    venue TEXT NOT NULL,
    exec_id TEXT NOT NULL,
    order_id TEXT,
    chart_symbol TEXT NOT NULL,
    unified_symbol TEXT,
    side TEXT NOT NULL,
    trade_side TEXT,
    price REAL,
    quantity REAL,
    pnl REAL,
    fee REAL,
    time_ms INTEGER NOT NULL,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (venue, exec_id)
);
CREATE INDEX IF NOT EXISTS idx_position_fills_symbol_time
    ON position_fills (venue, chart_symbol, time_ms);
CREATE TABLE IF NOT EXISTS venue_market_candles (
    venue TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (venue, symbol, interval, timestamp)
);
CREATE TABLE IF NOT EXISTS venue_market_cache_ranges (
    venue TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (venue, symbol, interval, start_timestamp, end_timestamp)
);
CREATE TABLE IF NOT EXISTS bitlang_trade_notes (
    trade_id TEXT NOT NULL PRIMARY KEY,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bitlang_trade_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bitlang_trade_tag_map (
    trade_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (trade_id, tag_id),
    FOREIGN KEY (tag_id) REFERENCES bitlang_trade_tags(id)
);
CREATE TABLE IF NOT EXISTS bitlang_trade_drawings (
    trade_id TEXT NOT NULL,
    id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    tool_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_id, id)
);
CREATE INDEX IF NOT EXISTS idx_bitlang_trade_drawings_scope
    ON bitlang_trade_drawings (trade_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exchange_positions_entry
    ON exchange_positions (entry_time_ms DESC);
"""
