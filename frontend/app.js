// ---------------------------------------------------------
// SafeRoute - Frontend Logic (FINAL FIXED VERSION)
// ---------------------------------------------------------

let map;
let userMarker = null;
let routePolylines = [];
let userLocation = null;

const API = CONFIG.API_URL;
const AUTH_KEY = CONFIG.AUTH_KEY;

// ---------------------------------------------------------
// TOAST (non-blocking, fixes map disappearance)
// ---------------------------------------------------------
function toast(msg, color = "#4CAF50") {
  const t = document.getElementById("toast");
  t.style.background = color;
  t.innerText = msg;
  t.classList.add("show");

  setTimeout(() => {
    t.classList.remove("show");
  }, 2600);
}

// ---------------------------------------------------------
// Map Initialization
// ---------------------------------------------------------
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 13,
    center: { lat: 17.4401, lng: 78.3489 }
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setCenter(userLocation);

      userMarker = new google.maps.Marker({
        position: userLocation,
        map: map,
        title: "Your location",
        icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
      });
    });
  }
}

window.initMap = initMap;

// ---------------------------------------------------------
// RELIABLE MAP RESIZE
// ---------------------------------------------------------
function forceMapResize() {
  if (!map) return;

  const attempt = () => {
    try {
      google.maps.event.trigger(map, "resize");
      if (userLocation) map.setCenter(userLocation);
    } catch {}
  };

  setTimeout(attempt, 80);
  setTimeout(attempt, 250);
  setTimeout(attempt, 600);
  setTimeout(attempt, 1000);
}

// ---------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------
function getToken() {
  return localStorage.getItem(AUTH_KEY);
}
function setToken(t) {
  if (!t) localStorage.removeItem(AUTH_KEY);
  else localStorage.setItem(AUTH_KEY, t);
}

function authHeaders() {
  const t = getToken();
  return t ? { "Authorization": "Bearer " + t } : {};
}

// ---------------------------------------------------------
// Draw Routes
// ---------------------------------------------------------
function drawRoute(points, color = "#4CAF50") {
  const path = points.map(p => ({ lat: p[0], lng: p[1] }));
  const polylineObj = new google.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: color,
    strokeOpacity: 1.0,
    strokeWeight: 5,
    map
  });
  routePolylines.push(polylineObj);
}

function clearRoutes() {
  routePolylines.forEach(r => r.setMap(null));
  routePolylines = [];
}

// ---------------------------------------------------------
// Route Calculation
// ---------------------------------------------------------
async function calculateRoute() {
  const start = document.getElementById("start").value;
  const end = document.getElementById("end").value;

  if (!start || !end) {
    toast("Please enter both start and destination", "#d9534f");
    return;
  }

  document.getElementById("routeStatus").innerText = "Calculating route...";

  try {
    const res = await fetch(`${API}/api/calculate-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ start, end })
    });

    const data = await res.json();

    if (!data.success) {
      document.getElementById("routeStatus").innerText = "Error: " + data.error;
      toast(data.error, "#d9534f");
      return;
    }

    clearRoutes();

    data.routes.forEach(r => drawRoute(r.points, "#B0B0B0"));

    const best = data.routes[data.best_index];
    drawRoute(best.points, "#00C851");

    document.getElementById("routeStatus").innerText =
      `Best Route: ${best.distance} | ${best.duration} | Safety: ${best.safety_score}`;

    toast("Route calculated!");

  } catch (err) {
    console.error(err);
    toast("Failed to calculate route", "#d9534f");
  }
}

// ---------------------------------------------------------
// Authentication Logic
// ---------------------------------------------------------
async function loadAuthState() {
  const token = getToken();
  const loginBtn = document.getElementById("openLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!token) {
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    document.getElementById("profileName").innerText = "Guest";
    document.getElementById("profileEmail").innerText = "";
    forceMapResize();
    return;
  }

  try {
    const resp = await fetch(`${API}/api/me`, { headers: authHeaders() });
    const data = await resp.json();

    if (data.success) {
      loginBtn.classList.add("hidden");
      logoutBtn.classList.remove("hidden");
      document.getElementById("profileName").innerText = data.user.name || data.user.email;
      document.getElementById("profileEmail").innerText = data.user.email;
    } else {
      setToken(null);
    }
  } catch {
    setToken(null);
  }

  forceMapResize();
}

// ---------------------------------------------------------
// Login Modal
// ---------------------------------------------------------
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

  openBtn.onclick = () => {
    modal.classList.remove("hidden");
    forceMapResize();
  };
  closeBtn.onclick = () => {
    modal.classList.add("hidden");
    forceMapResize();
  };

  toggleMode.onclick = (e) => {
    e.preventDefault();
    mode = mode === "login" ? "register" : "login";

    title.innerText = mode === "login" ? "Login" : "Register";
    submitBtn.innerText = mode === "login" ? "Login" : "Register";
    nameGroup.style.display = mode === "register" ? "block" : "none";

    forceMapResize();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();

    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    const name = document.getElementById("authName").value;

    const body = mode === "login"
      ? { email, password }
      : { email, password, name };

    try {
      const res = await fetch(`${API}/api/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (data.success) {
        setToken(data.token);
        modal.classList.add("hidden");
        await loadAuthState();

        toast(mode === "login" ? "Logged in!" : "Registered!");
      } else {
        toast(data.error, "#d9534f");
      }
    } catch {
      toast("Authentication failed", "#d9534f");
    }
  };
}

// ---------------------------------------------------------
// Logout
// ---------------------------------------------------------
function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  btn.onclick = () => {
    setToken(null);
    loadAuthState();
    toast("Logged out");
  };
}

// ---------------------------------------------------------
// Sidebar Toggle
// ---------------------------------------------------------
function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("toggleSidebar");

  toggle.onclick = () => {
    sidebar.classList.toggle("visible");
    forceMapResize();
  };
}

// ---------------------------------------------------------
// Emergency Contacts
// ---------------------------------------------------------
function setupContacts() {
  const openBtn = document.getElementById("openContactsBtn");
  const modal = document.getElementById("contactsModal");
  const closeBtn = document.getElementById("closeContacts");
  const addBtn = document.getElementById("addContactBtn");

  openBtn.onclick = async () => {
    if (!getToken()) return toast("Login required", "#d9534f");
    modal.classList.remove("hidden");
    await loadContacts();
    forceMapResize();
  };

  closeBtn.onclick = () => {
    modal.classList.add("hidden");
    forceMapResize();
  };

  addBtn.onclick = async () => {
    const name = document.getElementById("contactName").value.trim();
    const phone = document.getElementById("contactPhone").value.trim();

    if (!phone) return toast("Phone number required", "#d9534f");

    try {
      const res = await fetch(`${API}/api/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name, phone })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById("contactName").value = "";
        document.getElementById("contactPhone").value = "";
        await loadContacts();
        toast("Contact added!");
      } else {
        toast(data.error, "#d9534f");
      }

    } catch {
      toast("Request failed", "#d9534f");
    }
  };
}

async function loadContacts() {
  try {
    const res = await fetch(`${API}/api/contacts`, { headers: authHeaders() });
    const contacts = await res.json();

    const list = document.getElementById("contactsList");
    list.innerHTML = "";

    if (!contacts.length) {
      list.innerHTML = "<p>No contacts added.</p>";
      return;
    }

    contacts.forEach(c => {
      const div = document.createElement("div");
      div.className = "contact-item";
      div.innerHTML = `
        <div class="contact-row">
          <div>
            <strong>${c.name || "Unnamed"}</strong><br>
            <small>${c.phone}</small>
          </div>
          <button class="btn-secondary" onclick="deleteContact(${c.id})">Delete</button>
        </div>
      `;
      list.appendChild(div);
    });

  } catch (err) {
    toast("Failed to load contacts", "#d9534f");
  }
}

async function deleteContact(id) {
  try {
    const res = await fetch(`${API}/api/contacts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ id })
    });

    const data = await res.json();

    if (data.success) {
      loadContacts();
      toast("Deleted");
    } else {
      toast("Failed to delete", "#d9534f");
    }

  } catch {
    toast("Request failed", "#d9534f");
  }
}

// ---------------------------------------------------------
// SOS
// ---------------------------------------------------------
function setupSOS() {
  const btn = document.getElementById("sosBtn");
  btn.onclick = sendSOS;
}

async function sendSOS() {
  if (!getToken()) return toast("Login to send SOS", "#d9534f");
  if (!navigator.geolocation) return toast("Location unavailable", "#d9534f");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const message = prompt("Message for SOS:", "I need help!");

    const res = await fetch(`${API}/api/sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ lat, lng, message })
    });

    const data = await res.json();

    if (data.success) toast("SOS sent!");
    else toast(data.error, "#d9534f");
  });
}

// ---------------------------------------------------------
// Route History
// ---------------------------------------------------------
function setupHistory() {
  const btn = document.getElementById("openHistoryBtn");

  btn.onclick = async () => {
    if (!getToken()) return toast("Login to view history", "#d9534f");

    const res = await fetch(`${API}/api/route-history`, { headers: authHeaders() });
    const rows = await res.json();

    if (!rows.length) {
      toast("No history yet");
      return;
    }

    let msg = "Your Routes:\n\n";
    rows.forEach(r => {
      msg += `${r.created_at} | Score: ${r.safety_score}\n`;
    });

    toast("History displayed in console");
    console.log(msg);
  };
}

// ---------------------------------------------------------
// Report Issue
// ---------------------------------------------------------
function setupReport() {
  const openBtn = document.getElementById("openReportSidebarBtn");
  const modal = document.getElementById("reportModal");
  const closeBtn = document.getElementById("closeReport");
  const submitBtn = document.getElementById("submitReport");

  openBtn.onclick = () => {
    modal.classList.remove("hidden");
    forceMapResize();
  };

  closeBtn.onclick = () => {
    modal.classList.add("hidden");
    forceMapResize();
  };

  submitBtn.onclick = async () => {
    const type = document.getElementById("reportType").value;
    const desc = document.getElementById("reportDescription").value;

    if (!desc.trim()) return toast("Please add description", "#d9534f");

    const body = {
      report_type: type,
      description: desc,
      latitude: userLocation?.lat || null,
      longitude: userLocation?.lng || null
    };

    try {
      const res = await fetch(`${API}/api/report-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (data.success) {
        toast("Report submitted!");
        modal.classList.add("hidden");
      } else {
        toast(data.error, "#d9534f");
      }

    } catch {
      toast("Request failed", "#d9534f");
    }

    forceMapResize();
  };
}

// ---------------------------------------------------------
// On Page Load
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("calcBtn").onclick = calculateRoute;

  setupAuthUI();
  setupLogout();
  setupSidebar();
  setupContacts();
  setupSOS();
  setupHistory();
  setupReport();

  loadAuthState();
});
