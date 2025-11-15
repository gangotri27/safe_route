import sqlite3
from config import DATABASE_NAME

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DATABASE_NAME)
    cursor = conn.cursor()
    
    # Crime incidents table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS crime_incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            crime_type TEXT NOT NULL,
            date TEXT NOT NULL,
            severity INTEGER DEFAULT 3,
            description TEXT
        )
    ''')
    
    # User reports table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            report_type TEXT NOT NULL,
            description TEXT,
            reported_at TEXT NOT NULL
        )
    ''')
    
    # Route history table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS route_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_lat REAL,
            start_lng REAL,
            end_lat REAL,
            end_lng REAL,
            safety_score INTEGER,
            created_at TEXT
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ Database initialized successfully!")

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE_NAME)
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    return conn

if __name__ == '__main__':
    init_db()