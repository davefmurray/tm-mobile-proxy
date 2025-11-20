# TM Mobile Proxy Setup Guide

## 🎯 Quick Setup (2 Options)

### **Option 1: Run on Shop PC (Recommended)**

This prevents JWT token blacklisting completely.

#### Step 1: Install Node.js
```bash
# Download from https://nodejs.org
# Or use winget (Windows 11):
winget install OpenJS.NodeJS
```

#### Step 2: Clone and Run
```bash
git clone https://github.com/davefmurray/tm-mobile-proxy.git
cd tm-mobile-proxy

# Set JWT token (get from Chrome extension)
$env:TM_JWT_TOKEN="your_jwt_token_here"

# Start server
node server.js
```

#### Step 3: Get Shop PC IP Address
```bash
# Windows PowerShell:
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -like "192.168.*"}

# Or use Command Prompt:
ipconfig
# Look for "IPv4 Address" under your network adapter
```

#### Step 4: Test from Phone
Open browser on phone:
```
http://192.168.1.100:3001/health
```

Replace `192.168.1.100` with your shop PC's IP address.

Should return:
```json
{
  "status": "healthy",
  "jwt_configured": true
}
```

#### Step 5: Update Mobile App

Mobile app will automatically use proxy at:
```
http://<shop-pc-ip>:3001
```

---

### **Option 2: Railway Cloud (Requires Token Updates)**

Already deployed at:
```
https://tm-mobile-proxy-production.up.railway.app
```

#### Set JWT Token via Railway:
1. Go to https://railway.app/project/d92f5a64-e8e8-4388-981f-f493327a0bd3
2. Click on `tm-mobile-proxy` service
3. Go to **Variables** tab
4. Add variable:
   - Key: `TM_JWT_TOKEN`
   - Value: Your JWT token from Chrome extension
5. Click **Deploy**

**Note:** You'll need to update the token manually when it expires or changes.

---

## 🔧 Auto-Start on Shop PC (Windows)

### Using Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Name: "TM Mobile Proxy"
4. Trigger: "When the computer starts"
5. Action: "Start a program"
6. Program: `C:\Program Files\nodejs\node.exe`
7. Arguments: `C:\path\to\tm-mobile-proxy\server.js`
8. ✅ Finish

### Using PM2 (Recommended for Production)

```bash
# Install PM2 globally
npm install -g pm2

# Start proxy with PM2
pm2 start server.js --name tm-proxy

# Set environment variable
pm2 restart tm-proxy --update-env

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

---

## 📱 Mobile App Configuration

The mobile app needs to be updated to use the proxy. I'll update it now!

### Before (Direct to TM):
```javascript
const BASE_URL = 'https://shop.tekmetric.com/api';
```

### After (Via Proxy):
```javascript
const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL || 'http://192.168.1.100:3001';
```

---

## 🐛 Troubleshooting

### "JWT token not configured"
- ✅ Set `TM_JWT_TOKEN` environment variable
- ✅ Restart server after setting variable

### Can't connect from phone
- ✅ Phone and shop PC must be on same WiFi network
- ✅ Check Windows Firewall allows port 3001
- ✅ Use correct IP address (not `localhost`)

### Token still getting blacklisted
- ✅ Make sure ALL mobile app requests go through proxy
- ✅ Don't use token directly from mobile app
- ✅ Proxy must run on same PC where token was captured

---

## 🎉 You're All Set!

Proxy server running ✅
Mobile app connected ✅
No more token blacklisting ✅

Start uploading videos! 🚀
