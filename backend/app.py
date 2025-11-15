# ---------------------------------------------------------
# SafeRoute - Backend API (rewritten / cleaned)
# ---------------------------------------------------------

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import requests
import datetime
import jwt
import polyline
from werkzeug.security import generate_password_hash, check_password_hash
from twilio.rest import Client

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

app = Flask(__name__)
CORS(app)

# Initialize DB (creates tables if not present)
init_db()

# -----------------------
# JWT helpers
# -----------------------
def generate_token(user_id, hours=24):
    payload = {
        "user_id": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=hours),
        "iat": datetime.datetime.utcnow()
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    # pyjwt returns a str in modern versions; ensure str
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token

def decode_token(token):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except Exception:
        return None

def get_current_user():
    auth = request.headers.get("Authorization", None)
    if not auth:
        return None
    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("user_id")
    if not user_id:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

# -----------------------
# Authentication endpoints
# -----------------------

@app.route("/api/register", methods=["POST"])
def register():
    data = request.json or {}
    email = data.get("email")
    password = data.get("password")
    name = data.get("name", "")

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cur.fetchone():
        conn.close()
        return jsonify({"success": False, "error": "Email already registered"}), 400

    password_hash = generate_password_hash(password)
    cur.execute("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
                (email, password_hash, name))
    conn.commit()
    user_id = cur.lastrowid
    conn.close()

    token = generate_token(user_id)
    return jsonify({"success": True, "token": token, "user": {"id": user_id, "email": email, "name": name}}), 201

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, email, password_hash, name FROM users WHERE email = ?", (email,))
    row = cur.fetchone()
    conn.close()

    if not row:
        return jsonify({"success": False, "error": "Invalid credentials"}), 401

    if not check_password_hash(row["password_hash"], password):
        return jsonify({"success": False, "error": "Invalid credentials"}), 401

    token = generate_token(row["id"])
    return jsonify({"success": True, "token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"]}})

@app.route("/api/me", methods=["GET"])
def me():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    return jsonify({"success": True, "user": user})

# -----------------------
# Emergency contacts endpoints
# -----------------------

@app.route("/api/contacts", methods=["GET", "POST", "DELETE"])
def contacts():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    conn = get_db()
    cur = conn.cursor()

    if request.method == "GET":
        cur.execute("SELECT id, name, phone, added_at FROM emergency_contacts WHERE user_id = ?", (user["id"],))
        rows = cur.fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    if request.method == "POST":
        data = request.json or {}
        name = data.get("name", "")
        phone = data.get("phone")
        if not phone:
            conn.close()
            return jsonify({"success": False, "error": "Phone required"}), 400
        cur.execute("INSERT INTO emergency_contacts (user_id, name, phone) VALUES (?, ?, ?)", (user["id"], name, phone))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"success": True, "id": new_id}), 201

    if request.method == "DELETE":
        data = request.json or {}
        cid = data.get("id")
        if not cid:
            conn.close()
            return jsonify({"success": False, "error": "Contact id required"}), 400
        cur.execute("DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?", (cid, user["id"]))
        conn.commit()
        conn.close()
        return jsonify({"success": True})

# -----------------------
# SOS endpoint (Twilio)
# -----------------------

@app.route("/api/sos", methods=["POST"])
def sos():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    data = request.json or {}
    lat = data.get("lat")
    lng = data.get("lng")
    message_text = data.get("message", "Emergency! I need help.")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT name, phone FROM emergency_contacts WHERE user_id = ?", (user["id"],))
    contacts = cur.fetchall()
    conn.close()

    if not contacts:
        return jsonify({"success": False, "error": "No emergency contacts found"}), 400

    loc_link = f"https://www.google.com/maps/search/?api=1&query={lat},{lng}" if lat and lng else ""
    body = f"{user.get('name','A user')} sent an SOS.\n{message_text}\nLocation: {loc_link}"

    try:
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        for c in contacts:
            client.messages.create(body=body, from_=TWILIO_NUMBER, to=c["phone"])
    except Exception as e:
        print("Twilio error:", e)
        return jsonify({"success": False, "error": "Failed to send SMS"}), 500

    return jsonify({"success": True, "sent_to": [c["phone"] for c in contacts]})

# -----------------------
# Route history
# -----------------------

@app.route("/api/route-history", methods=["GET"])
def route_history():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, start_lat, start_lng, end_lat, end_lng, safety_score, created_at
        FROM route_history WHERE user_id = ? ORDER BY created_at DESC
    """, (user["id"],))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

# -----------------------
# Geocoding / Routing helpers
# -----------------------

def geocode_address(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": address, "key": GOOGLE_MAPS_API_KEY}
    r = requests.get(url, params=params).json()
    if r.get("status") != "OK":
        return None
    loc = r["results"][0]["geometry"]["location"]
    return loc["lat"], loc["lng"]

def get_crimes_near_point(lat, lng, radius_km):
    conn = get_db()
    cursor = conn.cursor()
    # approximate conversion: 1 km ~ 0.009 degrees
    radius_deg = radius_km * 0.009
    cursor.execute("""
        SELECT * FROM crime_incidents
        WHERE ABS(latitude - ?) < ?
        AND ABS(longitude - ?) < ?
    """, (lat, radius_deg, lng, radius_deg))
    crimes = cursor.fetchall()
    conn.close()
    return crimes

def get_google_route(lat1, lng1, lat2, lng2):
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": f"{lat1},{lng1}",
        "destination": f"{lat2},{lng2}",
        "mode": "driving",
        "alternatives": "true",
        "key": GOOGLE_MAPS_API_KEY
    }
    r = requests.get(url, params=params).json()
    if r.get("status") != "OK":
        print("Directions API Error:", r)
        return None
    routes = r.get("routes", [])
    decoded_routes = []
    for route in routes:
        leg = route["legs"][0]
        poly = route["overview_polyline"]["points"]
        decoded_points = polyline.decode(poly)
        decoded_routes.append({
            "points": decoded_points,
            "distance": leg["distance"]["text"],
            "duration": leg["duration"]["text"]
        })
    return decoded_routes

# -----------------------
# Calculate route endpoint
# -----------------------

@app.route("/api/calculate-route", methods=["POST"])
def calculate_route():
    data = request.json or {}
    start_text = data.get("start")
    end_text = data.get("end")
    if not start_text or not end_text:
        return jsonify({"success": False, "error": "Missing address text"}), 400

    start = geocode_address(start_text)
    end = geocode_address(end_text)
    if not start or not end:
        return jsonify({"success": False, "error": "Geocoding failed"}), 400

    start_lat, start_lng = start
    end_lat, end_lng = end
    routes = get_google_route(start_lat, start_lng, end_lat, end_lng)
    if not routes:
        return jsonify({"success": False, "error": "Route not found"}), 400

    scored_routes = []
    for r in routes:
        crime_total = 0
        # sample points to reduce DB load
        step = max(1, int(len(r["points"]) / 200))
        for lat, lng in r["points"][::step]:
            crimes = get_crimes_near_point(lat, lng, radius_km=0.2)
            crime_total += len(crimes)
        safety_score = max(0, 100 - crime_total * 3)
        scored_routes.append({
            "points": r["points"],
            "distance": r["distance"],
            "duration": r["duration"],
            "crime_count": crime_total,
            "safety_score": safety_score
        })

    best_index = 0
    best_score = -1
    for i, r in enumerate(scored_routes):
        if r["safety_score"] > best_score:
            best_score = r["safety_score"]
            best_index = i

    # if user is logged in, save a history row
    user = get_current_user()
    if user:
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO route_history (user_id, start_lat, start_lng, end_lat, end_lng, safety_score)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user["id"], start_lat, start_lng, end_lat, end_lng, scored_routes[best_index]["safety_score"]))
            conn.commit()
            conn.close()
        except Exception as e:
            print("Failed to save route history:", e)

    return jsonify({
        "success": True,
        "start": {"lat": start_lat, "lng": start_lng},
        "end": {"lat": end_lat, "lng": end_lng},
        "routes": scored_routes,
        "best_index": best_index
    })

# -----------------------
# Root endpoint
# -----------------------

@app.route("/")
def home():
    return jsonify({"message": "SafeRoute backend is running"})

# -----------------------
# Run server
# -----------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=FLASK_DEBUG)
