// API Configuration
const CONFIG = {
    // Backend API URL
    API_URL: 'http://localhost:5000',
    
    // Map center (Delhi, India - change to your city)
    MAP_CENTER: [28.6139, 77.2090],
    MAP_ZOOM: 13,
    
    // Add your API keys here later
    MAPBOX_TOKEN: 'YOUR_MAPBOX_TOKEN_HERE',
    GOOGLE_MAPS_KEY: 'AIzaSyAebd8duQVQT7TL9lL29FJaXef4IfZTtnI',
    
    // Crime severity colors
    CRIME_COLORS: {
        1: '#90EE90',  // Light green - Minor
        2: '#FFD700',  // Gold - Low
        3: '#FFA500',  // Orange - Medium
        4: '#FF6347',  // Tomato - High
        5: '#DC143C'   // Crimson - Severe
    }
};