// app.js - Final (MarkerClusterer + small markers by severity + routes + autocomplete + preserved features)
// Requires config.js (CONFIG.API_URL, CONFIG.AUTH_KEY) and Google Maps libraries=places,visualization loaded
// Also requires Chart.js loaded (index.html includes it)

let map;
let userMarker = null;
let userLocation = null;
let routePolylines = [];      // [{ polyline, color, weight }]
let crimeMarkers = [];        // individual marker objects (hidden from map when clusterer is used)
let clusterer = null;         // MarkerClusterer instance
let heatmap = null;
let crimeChart = null;

const API = CONFIG.API_URL;
const AUTH_KEY = CONFIG.AUTH_KEY;

// ---------------------- Utility: toast ----------------------
function toast(msg, color = "#4CAF50") {
  const t = document.getElementById("toast");
  if (!t) return console.log(msg);
  t.style.background = color;
  t.innerText = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ---------------------- SVG icon helpers ----------------------
// Create small circle SVG for single marker (severity based)
function singleMarkerSvg(colorHex, diameter = 12) {
  const size = diameter;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${(size/2)-1}" fill="${colorHex}" />
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Create cluster SVG (circle with count inside) for cluster icons
function clusterIconSvg(count, colorHex, diameter = 34) {
  const size = diameter;
  const fontSize = Math.max(12, Math.floor(diameter / 2.5));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${(size/2)-1}" fill="${colorHex}" />
    <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#fff" font-weight="700" text-anchor="middle" dominant-baseline="central">${count}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Color by severity 1-5 (A chosen mapping)
function colorBySeverity(sev) {
  const s = Number(sev) || 3;
  if (s <= 2) return "#28a745";   // green
  if (s === 3) return "#FFC107";  // yellow
  return "#FF3547";               // red
}

// ---------------------- initMap (Google maps callback) ----------------------
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 17.4401, lng: 78.3489 },
    zoom: 13,
    streetViewControl: false,
    mapTypeControl: false
  });

  // heatmap layer
  try {
    heatmap = new google.maps.visualization.HeatmapLayer({ data: [], dissipating: true, radius: 30 });
  } catch (e) {
    heatmap = null;
  }

  // Places Autocomplete for start and end
  try {
    const startEl = document.getElementById("start");
    const endEl = document.getElementById("end");
    if (google.maps.places) {
      new google.maps.places.Autocomplete(startEl, { fields: ["formatted_address", "geometry", "name"] });
      new google.maps.places.Autocomplete(endEl, { fields: ["formatted_address", "geometry", "name"] });
    }
  } catch (e) {
    console.warn("Autocomplete init failed:", e);
  }

  // attempt to get user location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setCenter(userLocation);
      userMarker = new google.maps.Marker({
        position: userLocation,
        map: map,
        title: "You",
        icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
      });
    }, (err) => {
      console.warn("Geolocation failed:", err);
    });
  }

  // load crimes & chart
  loadCrimes();
  setupCrimeChart();

  // ensure clusterer re-calculates on zoom change automatically (MarkerClusterer handles it)
}

window.initMap = initMap;

// ---------------------- Force map resize (prevents disappearance) ----------------------
function forceMapResize() {
  if (!map) return;
  const fn = () => {
    try {
      google.maps.event.trigger(map, "resize");
      if (userLocation) map.setCenter(userLocation);
    } catch (e) {}
  };
  setTimeout(fn, 80); setTimeout(fn, 260); setTimeout(fn, 640);
}

// ---------------------- AUTH helpers (unchanged behavior) ----------------------
function getToken() { return localStorage.getItem(AUTH_KEY); }
function setToken(t) { if (!t) localStorage.removeItem(AUTH_KEY); else localStorage.setItem(AUTH_KEY, t); }
function authHeaders() { const t = getToken(); return t ? { "Authorization": "Bearer " + t } : {}; }

// ---------------------- ROUTE drawing, list, selection ----------------------
function clearRoutes() {
  routePolylines.forEach(r => r.polyline.setMap(null));
  routePolylines = [];
  const list = document.getElementById("routesList");
  if (list) { list.innerHTML = ""; list.classList.add("hidden"); }
  document.getElementById("routeStatus").innerText = "";
}

function colorForScore(score) {
  if (score >= 70) return "#00C851";
  if (score >= 40) return "#FFB400";
  return "#FF3547";
}

function drawRoute(points, color = "#00C851", weight = 5) {
  const path = points.map(p => ({ lat: p[0], lng: p[1] }));
  const poly = new google.maps.Polyline({
    path: path,
    strokeColor: color,
    strokeOpacity: 1.0,
    strokeWeight: weight,
    map: map
  });
  routePolylines.push({ polyline: poly, color, weight });
  return poly;
}

function fitMapToPoints(points) {
  if (!points || !points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach(p => bounds.extend({ lat: p[0], lng: p[1] }));
  map.fitBounds(bounds);
}

function renderRoutesList(routes, bestIndex) {
  const container = document.getElementById("routesList");
  container.innerHTML = "";
  container.classList.remove("hidden");

  routes.forEach((r, idx) => {
    const color = colorForScore(r.safety_score);
    const item = document.createElement("div");
    item.className = "route-item";
    if (idx === bestIndex) item.classList.add("route-best");

    const badge = document.createElement("span");
    badge.className = "route-badge";
    badge.style.background = color;
    badge.innerText = `Score: ${r.safety_score}`;

    const meta = document.createElement("div");
    meta.className = "route-meta";
    meta.innerHTML = `<strong>${r.distance}</strong> • ${r.duration}`;

    const selectBtn = document.createElement("button");
    selectBtn.className = "btn-secondary route-select";
    selectBtn.innerText = (idx === bestIndex) ? "Best" : "Select";
    selectBtn.onclick = () => {
      routePolylines.forEach((rp, i) => {
        rp.polyline.setOptions({ strokeWeight: (i === idx ? 7 : 4) });
      });
      fitMapToPoints(routes[idx].points);
      container.querySelectorAll(".route-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
      toast(`Selected route ${idx + 1}`);
    };

    item.appendChild(badge);
    item.appendChild(meta);
    item.appendChild(selectBtn);
    container.appendChild(item);
  });
}

async function calculateRoute() {
  const start = document.getElementById("start").value.trim();
  const end = document.getElementById("end").value.trim();
  if (!start || !end) { toast("Please enter both start and destination", "#d9534f"); return; }
  document.getElementById("routeStatus").innerText = "Calculating route...";
  try {
    const res = await fetch(`${API}/api/calculate-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();
    if (!data.success) {
      document.getElementById("routeStatus").innerText = "Error: " + (data.error || "");
      toast(data.error || "Route failed", "#d9534f");
      return;
    }

    // clear prev
    clearRoutes();

    // draw all routes
    data.routes.forEach((r, idx) => {
      const c = colorForScore(r.safety_score);
      drawRoute(r.points, c, (idx === data.best_index ? 7 : 4));
    });

    renderRoutesList(data.routes, data.best_index);
    fitMapToPoints(data.routes[data.best_index].points);

    const best = data.routes[data.best_index];
    document.getElementById("routeStatus").innerText = `Best: ${best.distance} • ${best.duration} • Safety ${best.safety_score}`;
    toast("Routes loaded");
  } catch (err) {
    console.error("calculateRoute error:", err);
    toast("Failed to calculate route", "#d9534f");
  }
}

// ---------------------- AUTH UI (login/register/me) ----------------------
async function loadAuthState() {
  const loginBtn = document.getElementById("openLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const token = getToken();
  if (!token) {
    if (loginBtn) loginBtn.classList.remove("hidden");
    if (logoutBtn) logoutBtn.classList.add("hidden");
    const pn = document.getElementById("profileName"); if (pn) pn.innerText = "Guest";
    const pe = document.getElementById("profileEmail"); if (pe) pe.innerText = "";
    forceMapResize(); return;
  }
  try {
    const res = await fetch(`${API}/api/me`, { headers: authHeaders() });
    const d = await res.json();
    if (d.success) {
      if (loginBtn) loginBtn.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");
      const pn = document.getElementById("profileName"); if (pn) pn.innerText = d.user.name || d.user.email;
      const pe = document.getElementById("profileEmail"); if (pe) pe.innerText = d.user.email;
    } else setToken(null);
  } catch (e) { setToken(null); }
  forceMapResize();
}

function setupAuthUI() {
  const modal = document.getElementById("authModal");
  const openBtn = document.getElementById("openLoginBtn");
  const closeBtn = document.getElementById("authClose");
  const toggleMode = document.getElementById("toggleAuthMode");
  const form = document.getElementById("authForm");
  const title = document.getElementById("authTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("authSubmit");
  let mode = "login";

  if (openBtn) openBtn.onclick = () => { if (modal) modal.classList.remove("hidden"); forceMapResize(); };
  if (closeBtn) closeBtn.onclick = () => { if (modal) modal.classList.add("hidden"); forceMapResize(); };
  if (toggleMode) toggleMode.onclick = (e) => { e.preventDefault(); mode = (mode === "login" ? "register" : "login"); if (title) title.innerText = (mode === "login" ? "Login" : "Register"); if (submitBtn) submitBtn.innerText = (mode === "login" ? "Login" : "Register"); if (nameGroup) nameGroup.style.display = (mode === "register" ? "block" : "none"); forceMapResize(); };

  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    const name = document.getElementById("authName").value;
    const body = (mode === "login") ? { email, password } : { email, password, name };
    try {
      const res = await fetch(`${API}/api/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        if (modal) modal.classList.add("hidden");
        await loadAuthState();
        toast(mode === "login" ? "Logged in!" : "Registered!");
      } else {
        toast(data.error || "Auth failed", "#d9534f");
      }
    } catch (err) {
      console.error("auth error:", err);
      toast("Auth request failed", "#d9534f");
    }
  };
}

function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.onclick = () => { setToken(null); loadAuthState(); toast("Logged out"); };
}

// ---------------------- Sidebar ----------------------
function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("toggleSidebar");
  if (!sidebar || !toggle) return;
  toggle.onclick = () => { sidebar.classList.toggle("visible"); setTimeout(forceMapResize, 140); };
  document.addEventListener("click", (ev) => {
    if (!sidebar.classList.contains("visible")) return;
    const target = ev.target;
    if (sidebar.contains(target) || toggle.contains(target)) return;
    sidebar.classList.remove("visible"); forceMapResize();
  });
}

// ---------------------- Contacts (CRUD) ----------------------
async function loadContacts() {
  try {
    const res = await fetch(`${API}/api/contacts`, { headers: authHeaders() });
    const data = await res.json();
    const list = document.getElementById("contactsList");
    list.innerHTML = "";
    if (!Array.isArray(data) || data.length === 0) { list.innerHTML = "<p>No contacts added.</p>"; return; }
    data.forEach(c => {
      const div = document.createElement("div"); div.className = "contact-item";
      div.innerHTML = `<div class="contact-row"><div><strong>${c.name || "Unnamed"}</strong><br><small>${c.phone}</small></div><button class="btn-secondary" onclick="deleteContact(${c.id})">Delete</button></div>`;
      list.appendChild(div);
    });
  } catch (err) { console.error("loadContacts err:", err); toast("Failed to load contacts", "#d9534f"); }
}

async function deleteContact(id) {
  try {
    const res = await fetch(`${API}/api/contacts`, { method: "DELETE", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (data.success) { await loadContacts(); toast("Deleted"); } else toast(data.error || "Delete failed", "#d9534f");
  } catch (err) { toast("Request failed", "#d9534f"); }
}

function setupContactsUI() {
  const openBtn = document.getElementById("openContactsBtn");
  const closeBtn = document.getElementById("closeContacts");
  const modal = document.getElementById("contactsModal");
  const addBtn = document.getElementById("addContactBtn");
  if (openBtn) openBtn.onclick = async () => { if (!getToken()) return toast("Login required", "#d9534f"); if (modal) modal.classList.remove("hidden"); await loadContacts(); forceMapResize(); };
  if (closeBtn) closeBtn.onclick = () => { if (modal) modal.classList.add("hidden"); forceMapResize(); };
  if (addBtn) addBtn.onclick = async () => {
    const name = document.getElementById("contactName").value.trim();
    const phone = document.getElementById("contactPhone").value.trim();
    if (!phone) return toast("Phone required", "#d9534f");
    try {
      const res = await fetch(`${API}/api/contacts`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name, phone }) });
      const data = await res.json();
      if (data.success) { document.getElementById("contactName").value = ""; document.getElementById("contactPhone").value = ""; await loadContacts(); toast("Contact added"); } else toast(data.error || "Add failed", "#d9534f");
    } catch (err) { console.error("add contact err:", err); toast("Request failed", "#d9534f"); }
  };
}

// ---------------------- SOS ----------------------
function setupSOS() {
  const btn = document.getElementById("sosBtn");
  if (!btn) return;
  btn.onclick = sendSOS;
}
async function sendSOS() {
  if (!getToken()) return toast("Login to send SOS", "#d9534f");
  if (!navigator.geolocation) return toast("Location unavailable", "#d9534f");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const message = prompt("Message for SOS:", "I need help!");
    try {
      const res = await fetch(`${API}/api/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ lat, lng, message })
      });
      const data = await res.json();
      if (data.success) toast("SOS sent!");
      else toast(data.error || "SOS failed", "#d9534f");
    } catch (err) { console.error("SOS err:", err); toast("Request failed", "#d9534f"); }
  }, (err) => { toast("Location error", "#d9534f"); });
}

// ---------------------- History ----------------------
function setupHistory() {
  const btn = document.getElementById("openHistoryBtn");
  if (!btn) return;
  btn.onclick = async () => {
    if (!getToken()) return toast("Login to view history", "#d9534f");
    try {
      const res = await fetch(`${API}/api/route-history`, { headers: authHeaders() });
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return toast("No history yet");
      console.table(rows);
      toast("History logged to console");
    } catch (err) { console.error("history err:", err); toast("Request failed", "#d9534f"); }
  };
}

// ---------------------- Report ----------------------
function setupReportUI() {
  const openBtn = document.getElementById("openReportSidebarBtn");
  const closeBtn = document.getElementById("closeReport");
  const modal = document.getElementById("reportModal");
  const submitBtn = document.getElementById("submitReport");
  if (openBtn) openBtn.onclick = () => { if (modal) modal.classList.remove("hidden"); forceMapResize(); };
  if (closeBtn) closeBtn.onclick = () => { if (modal) modal.classList.add("hidden"); forceMapResize(); };
  if (submitBtn) submitBtn.onclick = async () => {
    const type = document.getElementById("reportType").value;
    const desc = document.getElementById("reportDescription").value.trim();
    if (!desc) return toast("Please add description", "#d9534f");
    const body = { report_type: type, description: desc, latitude: userLocation?.lat || null, longitude: userLocation?.lng || null };
    try {
      const res = await fetch(`${API}/api/report-issue`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { toast("Report submitted!"); if (modal) modal.classList.add("hidden"); } else toast(data.error || "Report failed", "#d9534f");
    } catch (err) { console.error("report err:", err); toast("Request failed", "#d9534f"); }
    forceMapResize();
  };
}

// ---------------------- CRIMES: create individual markers + MarkerClusterer ----------------------
async function loadCrimes() {
  try {
    const res = await fetch(`${API}/api/crimes`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    // remove old markers & clusterer
    if (clusterer) {
      try { clusterer.clearMarkers(); } catch (e) {}
      clusterer = null;
    }
    crimeMarkers.forEach(m => { if (m.setMap) m.setMap(null); });
    crimeMarkers = [];

    // build individual markers (small circle icons colored by severity)
    const markers = data.map(c => {
      const color = colorBySeverity(c.severity);
      const iconUrl = singleMarkerSvg(color, 12);
      const m = new google.maps.Marker({
        position: { lat: c.latitude, lng: c.longitude },
        title: (c.crime_type || "Incident") + (c.description ? (" - " + c.description) : ""),
        icon: {
          url: iconUrl,
          scaledSize: new google.maps.Size(12, 12),
          anchor: new google.maps.Point(6, 6)
        }
      });

      // Info window on click
      m.addListener("click", () => {
        const iw = new google.maps.InfoWindow({
          content: `<strong>${c.crime_type || "Incident"}</strong><br>${c.date || ""}<br>Severity: ${c.severity || '-'}<br>${c.description || ''}`
        });
        iw.open(map, m);
      });

      crimeMarkers.push(m);
      return m;
    });

    // heatmap update
    if (heatmap) {
      const heatPts = data.map(c => new google.maps.LatLng(c.latitude, c.longitude));
      heatmap.setData(heatPts);
      heatmap.setMap(map);
    }

    // use MarkerClusterer for automatic cluster/split behavior
    // markerclusterer library exposes markerClusterer namespace
    if (typeof markerClusterer !== "undefined" || typeof window.markerClusterer !== "undefined" || typeof MarkerClusterer !== "undefined") {
      // choose the available namespace
      const MC = (typeof markerClusterer !== "undefined") ? markerClusterer : (typeof window.markerClusterer !== "undefined" ? window.markerClusterer : window.MarkerClusterer);
      // create custom renderer for cluster icons
      const renderer = {
        render: ({ count, position }) => {
          // color based on count (density)
          let color = "#28a745"; // green
          if (count > 15) color = "#FF3547";
          else if (count > 5) color = "#FFC107";

          const size = Math.min(48, 26 + Math.floor(Math.log(count + 1) * 6));
          const svgUrl = clusterIconSvg(count, color, size);
          return new google.maps.Marker({
            position,
            icon: { url: svgUrl, scaledSize: new google.maps.Size(size, size) },
            zIndex: 1000
          });
        }
      };

      // instantiate clusterer (use MarkerClusterer from namespace)
      try {
        clusterer = new MC.MarkerClusterer({ map, markers, renderer });
      } catch (err) {
        // If the unpkg global shape differs, attempt alternate constructor (fallback)
        try {
          clusterer = new MC({ map, markers, renderer });
        } catch (e2) {
          console.warn("MarkerClusterer instantiation fallback failed:", e2);
          // fallback: display individual markers on map
          markers.forEach(m => m.setMap(map));
        }
      }
    } else {
      // fallback if library not loaded: show individual markers
      crimeMarkers.forEach(m => m.setMap(map));
    }
  } catch (err) {
    console.error("loadCrimes failed:", err);
  }
}

// ---------------------- Chart ----------------------
function setupCrimeChart() {
  const el = document.getElementById("crimeChart");
  if (!el || typeof Chart === "undefined") return;
  crimeChart = new Chart(el.getContext("2d"), {
    type: "bar",
    data: { labels: ['1','2','3','4','5'], datasets: [{ label: "Incidents", data: [0,0,0,0,0] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function updateCrimeChart(counts) {
  if (!crimeChart) return;
  const arr = [counts[1]||0, counts[2]||0, counts[3]||0, counts[4]||0, counts[5]||0];
  crimeChart.data.datasets[0].data = arr;
  crimeChart.update();
}

// ---------------------- Wire UI on DOMContentLoaded ----------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("calcBtn").onclick = calculateRoute;
  document.getElementById("clearRoutesBtn").onclick = clearRoutes;
  document.getElementById("refreshCrimes").onclick = () => { loadCrimes(); toast("Refreshing crimes..."); };

  setupAuthUI();
  setupLogout();
  setupSidebar();
  setupContactsUI();
  setupSOS();
  setupHistory();
  setupReportUI();

  loadAuthState();
});
