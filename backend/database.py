import sqlite3
from config import DATABASE_NAME

def get_db():
    """
    Return a new SQLite connection with row_factory set to sqlite3.Row.
    Caller should close the connection when finished.
    """
    conn = sqlite3.connect(DATABASE_NAME, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    """
    Initialize all required tables. Safe to call multiple times.
    """
    conn = get_db()
    cur = conn.cursor()

    # crime_incidents table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS crime_incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            crime_type TEXT NOT NULL,
            date TEXT NOT NULL DEFAULT (datetime('now')),
            severity INTEGER DEFAULT 3,
            description TEXT
        )
    ''')

    # user_reports table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS user_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            report_type TEXT NOT NULL,
            description TEXT,
            reported_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    # users table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')

    # emergency_contacts table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS emergency_contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT,
            phone TEXT NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    # route_history table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS route_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            start_lat REAL,
            start_lng REAL,
            end_lat REAL,
            end_lng REAL,
            safety_score INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    ''')

    conn.commit()
    conn.close()
    print("✅ Database initialized / verified successfully (tables exist).")

if __name__ == "__main__":
    init_db()
