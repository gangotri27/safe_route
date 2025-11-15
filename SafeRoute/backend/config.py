# config.py - SafeRoute (merged A+B)
# NOTE: you asked to keep values directly in this file (no env variables)

# Google Maps API
GOOGLE_MAPS_API_KEY = "AIzaSyAebd8duQVQT7TL9lL29FJaXef4IfZTtnI"

# Twilio (optional) - if not set, SMS won't be sent but SOS will be recorded
TWILIO_SID = "YOUR_TWILIO_SID_HERE"
TWILIO_TOKEN = "YOUR_TWILIO_TOKEN_HERE"
TWILIO_NUMBER = "+1234567890"

# JWT secret
JWT_SECRET = "SUPER_SECRET_JWT_KEY_CHANGE_THIS"

# Database
DATABASE_NAME = "safe_route.db"

# Flask server
FLASK_PORT = 5000
FLASK_DEBUG = True
