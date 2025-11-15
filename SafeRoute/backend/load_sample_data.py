import sqlite3
import csv
from database import init_db, DATABASE_NAME

def load_crime_data():
    """Load sample crime data from CSV into database"""
    init_db()  # Make sure tables exist
    
    conn = sqlite3.connect(DATABASE_NAME)
    cursor = conn.cursor()
    
    # Clear existing data
    cursor.execute('DELETE FROM crime_incidents')
    
    # Load from CSV
    with open('data/sample_crime_data.csv', 'r') as f:
        reader = csv.DictReader(f)
        count = 0
        for row in reader:
            cursor.execute('''
                INSERT INTO crime_incidents (latitude, longitude, crime_type, date, severity, description)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                float(row['latitude']),
                float(row['longitude']),
                row['crime_type'],
                row['date'],
                int(row['severity']),
                row['description']
            ))
            count += 1
    
    conn.commit()
    conn.close()
    print(f"✅ Loaded {count} crime records into database!")

if __name__ == '__main__':
    load_crime_data()