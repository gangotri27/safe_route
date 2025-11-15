
// Global variables
let map;
let crimeMarkers = [];
let routeLayers = []; // array of polylines for multiple routes
let selectedRouteIndex = null;
let userLocation = null;

// 🆕 NEW — Track start/end markers and user marker
let startEndMarkers = [];
let userMarker = null;

// Initialize app when page loads
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    loadCrimeData();
    setupEventListeners();
    updateCurrentTime();
    initAutocomplete(); 
    testBackendConnection();
});

// 1. INIT MAP
function initMap() {
    map = L.map('map').setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

// 2. BACKEND CONNECTIVITY TEST
async function testBackendConnection() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/`);
        const data = await response.json();
        console.log("✅ Backend connected:", data.message);
    } catch (error) {
        console.error("❌ Backend connection failed:", error);
        alert("Backend not running! Start Flask on port 5000.");
    }
}

// 3. LOAD CRIME DATA
async function loadCrimeData() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/api/crime-data`);
        const data = await response.json();   
        const crimes = data.crimes || [];     

        crimeMarkers.forEach(m => map.removeLayer(m));
        crimeMarkers = [];

        crimes.forEach(crime => {
            const color = CONFIG.CRIME_COLORS[crime.severity] || "#999";
            const marker = L.circleMarker([crime.latitude, crime.longitude], {
                radius: 8,
                fillColor: color,
                color: "#fff",
                weight: 2,
                fillOpacity: 0.7
            }).addTo(map);

            marker.bindPopup(`
                <strong>${crime.type}</strong><br>
                Severity: ${crime.severity}/5
            `);

            crimeMarkers.push(marker);
        });

    } catch (error) {
        console.error("❌ Error loading crime data:", error);
    }
}


// 4. EVENT LISTENERS
function setupEventListeners() {
    document.getElementById("findRouteBtn").addEventListener("click", calculateRoute);
    document.getElementById("useCurrentLocation").addEventListener("click", getCurrentLocation);
    document.getElementById("reportIncidentBtn").addEventListener("click", openReportModal);
    document.getElementById("viewStatsBtn").addEventListener("click", toggleStatsChart);
    document.getElementById("reportForm").addEventListener("submit", submitIncidentReport);
    document.querySelector(".close").addEventListener("click", closeReportModal);
}

// 5. GET USER LOCATION
function getCurrentLocation() {
    if (!navigator.geolocation) { alert("Geolocation not supported"); return; }
    const btn = document.getElementById("useCurrentLocation");
    btn.textContent = "Getting location...";
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(pos => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById("startInput").value = `${userLocation.lat}, ${userLocation.lng}`;
        map.setView([userLocation.lat, userLocation.lng], 15);

        // 🆕 NEW — Remove old user marker if exists
        if (userMarker) map.removeLayer(userMarker);

        userMarker = L.marker([userLocation.lat, userLocation.lng]).addTo(map).bindPopup("📍 You are here").openPopup();
        
        btn.textContent = "Use My Location"; 
        btn.disabled = false;
    }, err => {
        alert("Location unavailable"); 
        btn.textContent = "Use My Location"; 
        btn.disabled = false;
    });
}

// 6. AUTOCOMPLETE (Places)
function initAutocomplete() {
    try {
        const startInput = document.getElementById("startInput");
        const endInput = document.getElementById("endInput");
        if (window.google && google.maps && google.maps.places) {
            new google.maps.places.Autocomplete(startInput);
            new google.maps.places.Autocomplete(endInput);
            console.log("✅ Google Places Autocomplete enabled");
        } else {
            console.log("⚠️ Google Places library not loaded (check API key/script).");
        }
    } catch (e) {
        console.warn("Autocomplete init error:", e);
    }
}


// 7. CALCULATE ROUTE
async function calculateRoute() {
    const startText = document.getElementById('startInput').value.trim();
    const endText = document.getElementById('endInput').value.trim();
    if (!startText || !endText) { alert("Enter both start and destination"); return; }

    document.getElementById("loadingOverlay").classList.remove("hidden");

    try {
        const resp = await fetch(`${CONFIG.API_URL}/api/calculate-route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: startText, end: endText })
        });
        const data = await resp.json();

        if (!data.success) { alert("Error: " + (data.error || "Route failed")); return; }

        // 🆕 NEW — Remove previous route polylines
        routeLayers.forEach(l => map.removeLayer(l));
        routeLayers = [];

        // 🆕 NEW — Remove old start/end markers
        startEndMarkers.forEach(m => map.removeLayer(m));
        startEndMarkers = [];

        selectedRouteIndex = null;

        data.routes.forEach((r, idx) => {
            const pts = r.points.map(p => [p[0], p[1]]);
            const color = r.safety_score >= 80 ? "#10b981" :
                          r.safety_score >= 60 ? "#f59e0b" :
                          r.safety_score >= 40 ? "#f97316" : "#ef4444";

            const poly = L.polyline(pts, { color, weight: 5, opacity: 0.8 }).addTo(map);
            poly.bindPopup(`<strong>Route ${idx + 1}</strong><br>Safety: ${r.safety_score}<br>Crimes: ${r.crime_count}<br>Distance: ${r.distance}<br>Duration: ${r.duration}`);
            poly.on('click', () => selectRoute(idx));
            routeLayers.push(poly);
        });

        // 🆕 NEW — Add new start marker
        const startMarker = L.marker([data.start.lat, data.start.lng]).addTo(map).bindPopup("🚀 Start");
        startEndMarkers.push(startMarker);
        startMarker.openPopup();

        // 🆕 NEW — Add new end marker
        const endMarker = L.marker([data.end.lat, data.end.lng]).addTo(map).bindPopup("🎯 Destination");
        startEndMarkers.push(endMarker);

        const best = data.best_index ?? 0;
        selectRoute(best);

    } catch (error) {
        console.error("❌ Route error:", error);
        alert("Server error. Check backend logs.");
    } finally {
        document.getElementById("loadingOverlay").classList.add("hidden");
    }
}

function updateCurrentTime() {
    const el = document.getElementById("currentTime");
    setInterval(() => {
        el.textContent = new Date().toLocaleString();
    }, 1000);
}


// Select (highlight) a route by index
function selectRoute(index) {
    if (!routeLayers || !routeLayers[index]) return;

    routeLayers.forEach((layer, i) => {
        layer.setStyle({ weight: 5, opacity: 0.6 });
        if (i === index) layer.setStyle({ weight: 8, opacity: 1.0 });
    });

    map.fitBounds(routeLayers[index].getBounds(), { padding: [30, 30] });
    routeLayers[index].openPopup();

    const popup = routeLayers[index].getPopup();
    if (popup) {
        const html = popup.getContent();
        const safetyMatch = html.match(/Safety:\s*([0-9]+)/);
        const crimeMatch = html.match(/Crimes:\s*([0-9]+)/);
        const durationMatch = html.match(/Duration:\s*([^<]+)/);
        const distanceMatch = html.match(/Distance:\s*([^<]+)/);

        const safety = safetyMatch ? parseInt(safetyMatch[1], 10) : "--";
        const crimes = crimeMatch ? parseInt(crimeMatch[1], 10) : "--";
        const duration = durationMatch ? durationMatch[1].trim() : "--";
        const distance = distanceMatch ? distanceMatch[1].trim() : "--";

        displaySafetyScore(safety, crimes);
        const durEl = document.getElementById("routeDuration");
        const disEl = document.getElementById("routeDistance");
        if (durEl) durEl.textContent = duration;
        if (disEl) disEl.textContent = distance;
    }

    selectedRouteIndex = index;
}

// SAFETY SCORE DISPLAY
function displaySafetyScore(score, crimeCount) {
    const scoreEl = document.getElementById("safetyScore");
    const crimeEl = document.getElementById("crimeCount");
    if (scoreEl) scoreEl.textContent = score;
    if (crimeEl) crimeEl.textContent = crimeCount;

    const level = document.getElementById("safetyLevel");
    if (!level) return;
    if (score >= 80) { level.textContent = "Very Safe"; level.style.color = "#10b981"; }
    else if (score >= 60) { level.textContent = "Moderately Safe"; level.style.color = "#f59e0b"; }
    else if (score >= 40) { level.textContent = "Use Caution"; level.style.color = "#f97316"; }
    else { level.textContent = "High Risk"; level.style.color = "#ef4444"; }
}

function getSafetyColor(score) {
    if (score >= 80) return "#10b981";
    if (score >= 60) return "#f59e0b";
    if (score >= 40) return "#f97316";
    return "#ef4444";
}

// REPORT INCIDENT
function openReportModal() { document.getElementById("reportModal").style.display = "block"; }
function closeReportModal() { document.getElementById("reportModal").style.display = "none"; }

async function submitIncidentReport(e) {
    e.preventDefault();
    const type = document.getElementById("incidentType").value;
    const desc = document.getElementById("incidentDescription").value;
    const useLoc = document.getElementById("useCurrentLocationForReport").checked;
    if (!type) return alert("Select a type");

    let lat, lng;
    if (useLoc) {
        if (!userLocation) return alert("Enable location first");
        lat = userLocation.lat; 
        lng = userLocation.lng;
    } else {
        const c = map.getCenter(); 
        lat = c.lat; 
        lng = c.lng;
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/report-incident`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude: lat, longitude: lng, report_type: type, description: desc })
        });
        const data = await response.json();
        if (data.success) { alert("Incident reported!"); closeReportModal(); loadCrimeData(); }
    } catch (error) { alert("Server error while reporting."); }
}

// CHART STATS
async function toggleStatsChart() {
    const chart = document.getElementById("chartSection");
    if (chart.classList.contains("hidden")) { 
        chart.classList.remove("hidden"); 
        await loadCrimeStats(); 
    }
    else chart.classList.add("hidden");
}

async function loadCrimeStats() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/api/crime-stats`);
        const data = await response.json();
        const ctx = document.getElementById("crimeChart").getContext("2d");
        if (window.crimeChartInstance) window.crimeChartInstance.destroy();

        window.crimeChartInstance = new Chart(ctx, {
            type: "bar",
            data: { 
                labels: data.labels, 
                datasets: [{
                    label: "Incidents", 
                    data: data.values, 
                    backgroundColor: "rgba(255, 99, 132, 0.7)",
                    borderColor: "rgba(255, 99, 132, 1)", 
                    borderWidth: 2 
                }] 
            }
        });
    } catch (error) { console.error(error); }
}

console.log("🛡️ Safe Route Finder loaded");
