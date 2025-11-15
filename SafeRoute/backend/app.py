# app.py - merged backend (A+B)
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests, sqlite3, datetime, jwt, polyline, socket
from werkzeug.security import generate_password_hash, check_password_hash

# Twilio optional import
try:
    from twilio.rest import Client
except Exception:
    Client = None

from config import (
    GOOGLE_MAPS_API_KEY,
    TWILIO_SID,
    TWILIO_TOKEN,
    TWILIO_NUMBER,
    JWT_SECRET,
    DATABASE_NAME,
    FLASK_PORT,
    FLASK_DEBUG
)
from database import init_db, get_db

# Force IPv4 for requests (fixes networks with IPv6 issues)
def allow_ipv4_only():
    import requests.packages.urllib3.util.connection as urllib3_cn
    urllib3_cn.allowed_gai_family = lambda: socket.AF_INET
allow_ipv4_only()

session = requests.Session()
DEFAULT_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SafeRoute/1.0)"}
REQUEST_TIMEOUT = 6

def safe_get(url, params):
    try:
        r = session.get(url, params=params, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT)
        return r.json()
    except Exception as e:
        print("Network error contacting:", url, "error:", e)
        return {"status": "REQUEST_FAILED", "error": str(e)}

# Init app
app = Flask(__name__)
CORS(app)
init_db()

# JWT helpers
def generate_token(user_id, hours=24):
    payload = {"user_id": user_id, "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=hours), "iat": datetime.datetime.utcnow()}
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token

def decode_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except:
        return None

def get_current_user():
    auth = request.headers.get("Authorization")
    if not auth:
        return None
    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    payload = decode_token(parts[1])
    if not payload: return None
    uid = payload.get("user_id")
    if not uid: return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, email, name FROM users WHERE id = ?", (uid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

# Auth endpoints
@app.route("/api/register", methods=["POST"])
def register():
    data = request.json or {}
    email = data.get("email"); password = data.get("password"); name = data.get("name","")
    if not email or not password:
        return jsonify({"success": False, "error": "Email and password required"}), 400
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cur.fetchone():
        conn.close(); return jsonify({"success": False, "error": "Email already registered"}), 400
    ph = generate_password_hash(password)
    cur.execute("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)", (email, ph, name))
    conn.commit(); uid = cur.lastrowid; conn.close()
    token = generate_token(uid)
    return jsonify({"success": True, "token": token, "user": {"id": uid, "email": email, "name": name}}), 201

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    email = data.get("email"); password = data.get("password")
    if not email or not password:
        return jsonify({"success": False, "error": "Email and password required"}), 400
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT id, email, password_hash, name FROM users WHERE email = ?", (email,))
    row = cur.fetchone(); conn.close()
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"success": False, "error": "Invalid credentials"}), 401
    token = generate_token(row["id"])
    return jsonify({"success": True, "token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"]}})

@app.route("/api/me", methods=["GET"])
def me():
    user = get_current_user()
    if not user: return jsonify({"success": False, "error": "Unauthorized"}), 401
    return jsonify({"success": True, "user": user})

# Contacts
@app.route("/api/contacts", methods=["GET","POST","DELETE"])
def contacts():
    user = get_current_user()
    if not user: return jsonify({"success": False, "error": "Unauthorized"}), 401
    conn = get_db(); cur = conn.cursor()
    if request.method == "GET":
        cur.execute("SELECT id, name, phone, added_at FROM emergency_contacts WHERE user_id = ?", (user["id"],))
        rows = cur.fetchall(); conn.close(); return jsonify([dict(r) for r in rows])
    if request.method == "POST":
        data = request.json or {}; phone = data.get("phone"); name = data.get("name","")
        if not phone: conn.close(); return jsonify({"success": False, "error": "Phone required"}), 400
        cur.execute("INSERT INTO emergency_contacts (user_id,name,phone) VALUES (?, ?, ?)", (user["id"], name, phone))
        conn.commit(); nid = cur.lastrowid; conn.close(); return jsonify({"success": True, "id": nid}), 201
    if request.method == "DELETE":
        data = request.json or {}; cid = data.get("id")
        if not cid: conn.close(); return jsonify({"success": False, "error": "id required"}), 400
        cur.execute("DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?", (cid, user["id"]))
        conn.commit(); conn.close(); return jsonify({"success": True})

# SOS - robust
@app.route("/api/sos", methods=["POST"])
def sos():
    user = get_current_user(); 
    if not user: return jsonify({"success": False, "error": "Unauthorized"}), 401
    data = request.json or {}; lat = data.get("lat"); lng = data.get("lng"); message = data.get("message","Emergency!")
    conn = get_db(); cur = conn.cursor()
    # fetch contacts
    cur.execute("SELECT name, phone FROM emergency_contacts WHERE user_id = ?", (user["id"],))
    contacts = cur.fetchall()
    # save as user report
    try:
        cur.execute("INSERT INTO user_reports (user_id, latitude, longitude, report_type, description) VALUES (?, ?, ?, ?, ?)",
                    (user["id"], lat, lng, "sos", message))
        conn.commit()
    except Exception as e:
        print("Failed to save SOS:", e)
    # no contacts -> return success with warning
    if not contacts:
        conn.close()
        return jsonify({"success": True, "warning": "No emergency contacts; SOS recorded."})
    # if Twilio configured attempt send
    if not (TWILIO_SID and TWILIO_TOKEN and TWILIO_NUMBER and Client):
        conn.close()
        return jsonify({"success": True, "warning": "Twilio not configured; SOS recorded."})
    try:
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        loc_link = f"https://maps.google.com/?q={lat},{lng}" if lat and lng else ""
        body = f"SOS from {user.get('name') or user.get('email')}\n{message}\nLocation: {loc_link}"
        sent = []
        for c in contacts:
            try:
                client.messages.create(body=body, from_=TWILIO_NUMBER, to=c["phone"])
                sent.append(c["phone"])
            except Exception as e:
                print("Twilio send failed for", c["phone"], e)
        conn.close()
        return jsonify({"success": True, "sent_to": sent})
    except Exception as e:
        conn.close(); print("Twilio error:", e)
        return jsonify({"success": True, "warning": "Twilio error occurred; SOS recorded."})

# Reports endpoint
@app.route("/api/report-issue", methods=["POST"])
def report_issue():
    user = get_current_user()
    data = request.json or {}
    lat = data.get("latitude"); lng = data.get("longitude"); rtype = data.get("report_type","user_report"); descr = data.get("description","")
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("INSERT INTO user_reports (user_id, latitude, longitude, report_type, description) VALUES (?, ?, ?, ?, ?)",
                    (user["id"] if user else None, lat, lng, rtype, descr))
        conn.commit(); nid = cur.lastrowid; conn.close()
        return jsonify({"success": True, "id": nid}), 201
    except Exception as e:
        print("Report save error:", e); return jsonify({"success": False, "error": "Failed to save report"}), 500

# Route helpers using safe_get
def geocode_address(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": address, "key": GOOGLE_MAPS_API_KEY}
    r = safe_get(url, params)
    if r.get("status") != "OK": return None
    loc = r["results"][0]["geometry"]["location"]; return loc["lat"], loc["lng"]

def get_google_route(lat1,lng1,lat2,lng2):
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {"origin": f"{lat1},{lng1}", "destination": f"{lat2},{lng2}", "mode":"driving", "alternatives":"true", "key":GOOGLE_MAPS_API_KEY}
    r = safe_get(url, params)
    if r.get("status") != "OK": return None
    out = []
    for route in r.get("routes",[]):
        leg = route["legs"][0]; poly = route["overview_polyline"]["points"]
        pts = polyline.decode(poly)
        out.append({"points": pts, "distance": leg["distance"]["text"], "duration": leg["duration"]["text"]})
    return out

def get_crimes_near_point(lat, lng, radius_km=0.2):
    conn = get_db(); cur = conn.cursor()
    radius_deg = radius_km * 0.009
    cur.execute("SELECT * FROM crime_incidents WHERE ABS(latitude - ?) < ? AND ABS(longitude - ?) < ?", (lat, radius_deg, lng, radius_deg))
    rows = cur.fetchall(); conn.close(); return rows

# Calculate route and score
@app.route("/api/calculate-route", methods=["POST"])
def calculate_route():
    data = request.json or {}
    start_text = data.get("start"); end_text = data.get("end")
    if not start_text or not end_text: return jsonify({"success": False, "error": "Missing address text"}), 400
    start = geocode_address(start_text); end = geocode_address(end_text)
    if not start or not end: return jsonify({"success": False, "error": "Geocoding failed"}), 400
    s_lat,s_lng = start; e_lat,e_lng = end
    routes = get_google_route(s_lat,s_lng,e_lat,e_lng)
    if not routes: return jsonify({"success": False, "error": "Route not found"}), 400
    scored = []
    for r in routes:
        crime_total = 0
        step = max(1, int(len(r["points"]) / 200))
        for lat,lng in r["points"][::step]:
            crimes = get_crimes_near_point(lat,lng,0.2)
            crime_total += len(crimes)
        score = max(0, 100 - crime_total * 3)
        scored.append({"points": r["points"], "distance": r["distance"], "duration": r["duration"], "crime_count": crime_total, "safety_score": score})
    best_index = max(range(len(scored)), key=lambda i: scored[i]["safety_score"])
    # save history
    user = get_current_user()
    if user:
        try:
            conn = get_db(); cur = conn.cursor()
            cur.execute("INSERT INTO route_history (user_id, start_lat, start_lng, end_lat, end_lng, safety_score) VALUES (?, ?, ?, ?, ?, ?)",
                        (user["id"], s_lat, s_lng, e_lat, e_lng, scored[best_index]["safety_score"]))
            conn.commit(); conn.close()
        except Exception as e:
            print("History save failed:", e)
    return jsonify({"success": True, "start":{"lat":s_lat,"lng":s_lng}, "end":{"lat":e_lat,"lng":e_lng}, "routes": scored, "best_index": best_index})

# Expose crime data for frontend (simple)
@app.route("/api/crimes", methods=["GET"])
def crimes():
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT id, latitude, longitude, crime_type, severity, description, date FROM crime_incidents LIMIT 1000")
    rows = cur.fetchall(); conn.close()
    return jsonify([dict(r) for r in rows])

# Route history endpoint
@app.route("/api/route-history", methods=["GET"])
def route_history():
    user = get_current_user()
    if not user: return jsonify({"success": False, "error": "Unauthorized"}), 401
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT id, start_lat, start_lng, end_lat, end_lng, safety_score, created_at FROM route_history WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
    rows = cur.fetchall(); conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/")
def home():
    return jsonify({"message": "SafeRoute backend running"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=FLASK_DEBUG)
