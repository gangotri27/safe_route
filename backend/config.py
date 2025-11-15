# ---------------------------------------------------------
#  SafeRoute - Configuration File
#
#  You asked to keep values hardcoded (no environment vars).
#  Replace any placeholders (Twilio keys, Google Maps key)
#  with your real keys when ready.
# ---------------------------------------------------------

# Google Maps API
GOOGLE_MAPS_API_KEY = "AIzaSyAebd8duQVQT7TL9lL29FJaXef4IfZTtnI"

# Mapbox (optional)
MAPBOX_API_KEY = "YOUR_MAPBOX_API_KEY_HERE"

# Twilio (for SOS SMS) - replace with your credentials if you want SMS to work
TWILIO_SID = "YOUR_TWILIO_SID_HERE"
TWILIO_TOKEN = "YOUR_TWILIO_TOKEN_HERE"
TWILIO_NUMBER = "+1234567890"

# JWT secret (change this to a long random string for production)
JWT_SECRET = "SUPER_SECRET_JWT_KEY_CHANGE_THIS"

# SQLite database filename (keeps DB local)
DATABASE_NAME = "safe_route.db"

# Flask server settings
FLASK_PORT = 5000
FLASK_DEBUG = True
