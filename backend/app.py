from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import sqlite3
import polyline
from config import GOOGLE_MAPS_API_KEY
from database import get_db

app = Flask(__name__)
CORS(app)


# ---------------------------------------------------------
# 1. Get crimes near point
# ---------------------------------------------------------
def get_crimes_near_point(lat, lng, radius_km):
    conn = get_db()
    cursor = conn.cursor()

    # 1 km = 0.009 degrees approx
    radius_deg = radius_km * 0.009

    cursor.execute("""
        SELECT * FROM crime_incidents
        WHERE ABS(latitude - ?) < ?
        AND ABS(longitude - ?) < ?
    """, (lat, radius_deg, lng, radius_deg))

    crimes = cursor.fetchall()
    conn.close()
    return crimes


# ---------------------------------------------------------
# 2. Geocode text address → lat/lng
# ---------------------------------------------------------
def geocode_address(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": address, "key": GOOGLE_MAPS_API_KEY}

    r = requests.get(url, params=params).json()

    if r.get("status") != "OK":
        print("Geocoding error:", r)
        return None

    loc = r["results"][0]["geometry"]["location"]
    return loc["lat"], loc["lng"]


# ---------------------------------------------------------
# 3. Google Directions API - returns ALL decoded routes
# ---------------------------------------------------------
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


# ---------------------------------------------------------
# 4. MAIN ENDPOINT — SUPPORTS TEXT ADDRESSES & MULTIPLE ROUTES
# ---------------------------------------------------------
@app.route("/api/calculate-route", methods=["POST"])
def calculate_route():
    data = request.json

    start_text = data.get("start")
    end_text = data.get("end")

    if not start_text or not end_text:
        return jsonify({"success": False, "error": "Missing address text"}), 400

    # 1. Convert text → coordinates
    start = geocode_address(start_text)
    end = geocode_address(end_text)

    if not start or not end:
        return jsonify({"success": False, "error": "Geocoding failed"}), 400

    start_lat, start_lng = start
    end_lat, end_lng = end

    # 2. Get Google routes (may contain several alternatives)
    routes = get_google_route(start_lat, start_lng, end_lat, end_lng)
    if not routes:
        return jsonify({"success": False, "error": "Route not found"}), 400

    # 3. Score each route by crime proximity
    scored_routes = []
    for r in routes:
        crime_total = 0
        # sample points (every Nth) to speed up analysis for long polylines
        step = max(1, int(len(r["points"]) / 200))  # check up to ~200 points
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

    # choose best route (highest safety score, tie-breaker: shorter duration)
    best_index = 0
    best_score = -1
    for i, r in enumerate(scored_routes):
        score = r["safety_score"]
        if score > best_score:
            best_score = score
            best_index = i

    return jsonify({
        "success": True,
        "start": {"lat": start_lat, "lng": start_lng},
        "end": {"lat": end_lat, "lng": end_lng},
        "routes": scored_routes,
        "best_index": best_index
    })


# ---------------------------------------------------------
# 5. Root endpoint
# ---------------------------------------------------------
@app.route("/")
def home():
    return jsonify({"message": "SafeRoute backend is running"})
@app.route("/api/crime-data", methods=["GET"])
def crime_data():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM crime_incidents")
    rows = cursor.fetchall()

    # convert rows to list of dicts
    crimes = []
    for r in rows:
        crimes.append({
            "id": r[0],
            "latitude": r[1],
            "longitude": r[2],
            "type": r[3],
            "severity": r[4]
        })

    return jsonify({"success": True, "crimes": crimes})


# ---------------------------------------------------------
# 6. Start server
# ---------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
