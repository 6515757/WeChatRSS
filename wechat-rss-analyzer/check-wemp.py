import sqlite3
conn = sqlite3.connect('/app/data/db.db')
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
print("Tables:", c.fetchall())
for t in ['mps', 'feeds', 'mp', 'articles', 'feed']:
    try:
        c.execute(f"SELECT count(*) FROM {t}")
        print(f"  {t}: {c.fetchone()[0]} rows")
    except:
        pass
# Try to find mp data
for t in ['mps', 'feeds', 'mp', 'feed']:
    try:
        c.execute(f"SELECT * FROM {t} LIMIT 2")
        cols = [d[0] for d in c.description]
        print(f"\n{t} columns: {cols}")
        for row in c.fetchall():
            print(f"  {row}")
    except:
        pass
conn.close()
