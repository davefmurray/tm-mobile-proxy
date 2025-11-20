# TM Mobile Proxy Server

**Lightweight proxy server that runs on shop PC to prevent JWT token blacklisting.**

## 🎯 Problem Solved

Tekmetric blacklists JWT tokens when used from different IP addresses. This proxy runs on the shop PC (where the token originated) and forwards requests from the mobile app.

## 🏗️ Architecture

```
Mobile App (Phone)
    ↓ HTTP Request
Proxy Server (Shop PC) ← JWT token stays here!
    ↓ HTTPS Request with JWT
Tekmetric API
    ↓ Response
Proxy Server
    ↓ Response
Mobile App
```

## ✨ Features

- ✅ **Zero dependencies** - Uses only Node.js built-in modules
- ✅ **Lightweight** - ~200 lines of code
- ✅ **Fast** - Direct HTTP proxy, no overhead
- ✅ **Secure** - JWT token never leaves shop PC
- ✅ **CORS enabled** - Works with mobile web apps
- ✅ **Easy setup** - Single file, runs in seconds

## 🚀 Quick Start

### On Shop PC:

1. **Install Node.js** (if not already installed)
   ```bash
   # Download from https://nodejs.org
   # Or use winget on Windows:
   winget install OpenJS.NodeJS
   ```

2. **Clone repository**
   ```bash
   git clone https://github.com/davefmurray/tm-mobile-proxy.git
   cd tm-mobile-proxy
   ```

3. **Set JWT token**
   ```bash
   # Windows PowerShell:
   $env:TM_JWT_TOKEN="your_jwt_token_here"
   node server.js

   # Windows CMD:
   set TM_JWT_TOKEN=your_jwt_token_here
   node server.js

   # Linux/Mac:
   TM_JWT_TOKEN=your_jwt_token_here node server.js
   ```

4. **Server starts!**
   ```
   🚀 TM Mobile Proxy Server
   ========================
   Port: 3001
   JWT Token: ✅ Set
   Allowed Origins: *

   ✅ Server running on http://localhost:3001
   ```

## 📱 Connect Mobile App

1. **Find shop PC IP address**
   ```bash
   # Windows:
   ipconfig
   # Look for "IPv4 Address" (e.g., 192.168.1.100)

   # Linux/Mac:
   ifconfig
   ```

2. **Update mobile app to use proxy**
   ```javascript
   // Instead of:
   const BASE_URL = 'https://shop.tekmetric.com/api';

   // Use:
   const PROXY_URL = 'http://192.168.1.100:3001/api';
   ```

3. **Test connection**
   ```bash
   # From phone browser:
   http://192.168.1.100:3001/health

   # Should return:
   {
     "status": "healthy",
     "jwt_configured": true
   }
   ```

## 🔌 API Endpoints

### Health Check
```bash
GET /health
```
Returns server status and JWT configuration.

### Get Inspections
```bash
GET /api/get-inspections?shopId=6212&roNumber=24715
```
Returns inspection tasks for a repair order.

### Get Presigned Upload URL
```bash
POST /api/upload-video/presigned
{
  "roId": 12345,
  "inspectionId": 67890,
  "itemId": 11111,
  "fileName": "inspection.webm",
  "fileType": "video/webm"
}
```
Returns S3 presigned URL for video upload.

### Confirm Upload
```bash
POST /api/upload-video/confirm
{
  "roId": 12345,
  "inspectionId": 67890,
  "itemId": 11111,
  "mediaId": 22222
}
```
Confirms video upload to TM.

### Update Inspection Item
```bash
POST /api/update-inspection-item
{
  "roId": 12345,
  "inspectionId": 67890,
  "itemId": 11111,
  "rating": 3,
  "finding": "needs front pads & rotors"
}
```
Updates inspection item rating and description.

### Generic Proxy
```bash
ANY /api/tm/*
```
Proxies any TM API endpoint. Replace `/api/tm/` with `/api/` when forwarding.

Example:
```bash
GET /api/tm/shop/6212/repair-order?number=24715
# Forwards to: https://shop.tekmetric.com/api/shop/6212/repair-order?number=24715
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `TM_JWT_TOKEN` | Tekmetric JWT token | Required |
| `ALLOWED_ORIGINS` | CORS allowed origins | `*` |

### Using .env file (optional)

Create `.env` file:
```bash
PORT=3001
TM_JWT_TOKEN=your_jwt_token_here
ALLOWED_ORIGINS=*
```

Then run with dotenv (requires installing `dotenv` package):
```bash
npm install dotenv
node -r dotenv/config server.js
```

Or stick with **zero dependencies** and use environment variables directly!

## 🔒 Security

### JWT Token Protection
- Token stored only as environment variable
- Never logged or exposed in responses
- Never transmitted to mobile app
- Only used for TM API requests

### CORS Configuration
- Default: All origins allowed (`*`)
- Restrict for production:
  ```bash
  ALLOWED_ORIGINS=https://your-mobile-app.com,http://192.168.1.100:3000
  ```

### Network Security
- Runs on local network only
- No internet exposure required
- Shop PC firewall controls access

## 🖥️ Running as Service

### Windows (using NSSM)

1. **Install NSSM** (Non-Sucking Service Manager)
   ```bash
   winget install NSSM.NSSM
   ```

2. **Install service**
   ```bash
   nssm install TMProxy "C:\Program Files\nodejs\node.exe" "C:\path\to\tm-mobile-proxy\server.js"
   nssm set TMProxy AppEnvironmentExtra TM_JWT_TOKEN=your_token_here
   nssm start TMProxy
   ```

### Linux (systemd)

Create `/etc/systemd/system/tm-proxy.service`:
```ini
[Unit]
Description=TM Mobile Proxy Server
After=network.target

[Service]
Type=simple
User=tm-proxy
WorkingDirectory=/opt/tm-mobile-proxy
Environment=TM_JWT_TOKEN=your_token_here
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable tm-proxy
sudo systemctl start tm-proxy
```

## 📊 Monitoring

View logs:
```bash
# Server outputs to console:
2025-11-20T16:30:45.123Z GET /health
2025-11-20T16:30:47.456Z GET /api/get-inspections
2025-11-20T16:30:50.789Z POST /api/upload-video/presigned
```

Health check endpoint:
```bash
curl http://localhost:3001/health
```

## 🐛 Troubleshooting

### Token blacklisted immediately
- ✅ Make sure proxy runs on same PC where token was captured
- ✅ Don't use token directly from mobile app
- ✅ All mobile requests must go through proxy

### Can't connect from phone
- ✅ Check shop PC firewall allows port 3001
- ✅ Verify phone on same network as shop PC
- ✅ Use correct IP address (not localhost)

### "JWT token not configured"
- ✅ Set `TM_JWT_TOKEN` environment variable
- ✅ Don't commit token to git (use .env)

## 🚢 Deployment Options

### Option 1: Shop PC (Recommended)
Run directly on shop PC where Chrome extension captures tokens.

### Option 2: Railway/Cloud (Advanced)
Deploy to cloud but update JWT token frequently:
```bash
# Railway:
railway variables set TM_JWT_TOKEN=new_token_here

# Or use Railway CLI:
railway up
```

**Note:** Cloud deployment requires manual token updates when tokens expire/change.

## 📝 Development

Run in development:
```bash
node server.js
```

Test endpoints:
```bash
# Health check
curl http://localhost:3001/health

# Get inspections
curl "http://localhost:3001/api/get-inspections?shopId=6212&roNumber=24715"
```

## 🤝 Contributing

This is a simple, single-file server. Improvements welcome:
- Better error handling
- Request logging
- Rate limiting
- Token refresh automation

## 📄 License

MIT

## 🎉 Credits

Built with Claude Code for seamless Tekmetric mobile integration!
