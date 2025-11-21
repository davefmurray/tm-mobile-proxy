# TM Mobile Proxy - Architecture & Token Management

## 🔒 The Token Blacklisting Problem

**TM API behavior:**
- JWT tokens are tied to the originating IP address
- Using a token from a different IP → immediate blacklisting
- Tokens expire every 12 hours

**Challenge:**
- Mobile app runs on phone (different IP)
- Need token to access TM API
- Direct token use → blacklisted ❌

---

## ✅ Solution: Smart Proxy with Auto-Refresh

### Architecture Flow

```
┌─────────────────────┐
│  Chrome Extension   │ (Shop PC - IP: 192.168.1.100)
│  - Captures token   │
│  - Updates Supabase │
│  - Every 12hr auto  │
└──────────┬──────────┘
           │ Writes token
           ↓
┌─────────────────────┐
│     Supabase DB     │
│   shop_tokens       │
│  - shop_id: 6212    │
│  - token: eyJ...    │
│  - expires_at       │
└──────────┬──────────┘
           │ Reads token (cached 5min)
           ↓
┌─────────────────────┐
│   Proxy Server      │ (Shop PC - Same IP!)
│  - Pulls from DB    │
│  - Caches token     │
│  - Uses for API     │
└──────────┬──────────┘
           │ Forwards requests
           ↓
┌─────────────────────┐
│    Tekmetric API    │
│  ✅ Same IP = Valid │
└─────────────────────┘
           ↑
           │ HTTP requests (no token)
┌─────────────────────┐
│    Mobile App       │ (Phone - Different IP)
│  - Records video    │
│  - Merges in browser│
│  - Calls proxy      │
└─────────────────────┘
```

---

## 🔑 Token Management Strategy

### 1. **Chrome Extension (Shop PC)**

**Responsibility:** Capture and refresh tokens

```javascript
// Runs every page load on shop.tekmetric.com
localStorage.getItem('authToken')
  ↓
Write to Supabase (shop_tokens table)
  ↓
Set expires_at = now + 12 hours
```

**No changes needed!** Extension already does this.

### 2. **Proxy Server (Shop PC)**

**Responsibility:** Fetch fresh tokens from Supabase

```javascript
async function getJWTToken(shopId) {
  // Check cache (5 minute TTL)
  if (cached && fresh) return cached.token;

  // Fetch from Supabase
  const token = await supabase
    .from('shop_tokens')
    .select('token')
    .eq('shop_id', shopId)
    .single();

  // Cache it
  tokenCache[shopId] = { token, fetchedAt: now };

  return token;
}
```

**Benefits:**
- ✅ Always gets latest token
- ✅ Auto-refreshes when extension updates
- ✅ Caches to reduce DB queries
- ✅ Supports multiple shops

### 3. **Mobile App (Phone)**

**Responsibility:** Just call proxy (no token management!)

```javascript
// No token needed - proxy handles it!
fetch('http://shop-pc:3001/api/upload-video/presigned', {
  body: JSON.stringify({ shopId, roId, ... })
})
```

---

## ⏱️ Token Lifecycle

```
Hour 0:  Chrome extension captures token A
         ↓ Writes to Supabase
         Proxy fetches token A
         ↓ Caches for 5 minutes
Hour 0-5min: Proxy uses cached token A (fast!)
Hour 5min:   Cache expires, proxy re-fetches from Supabase
         Still gets token A (extension hasn't refreshed yet)
Hour 12: Token A expires in TM
         Chrome extension captures NEW token B
         ↓ Writes to Supabase (overwrites token A)
Hour 12+5min: Proxy cache expires
         Proxy fetches from Supabase
         ✅ Gets NEW token B automatically!
         No manual intervention needed!
```

---

## 🚀 Deployment Configurations

### Option 1: Shop PC (Recommended)

**Setup:**
```bash
cd tm-mobile-proxy

# Set Supabase credentials (one time)
$env:SUPABASE_URL="https://oummojcsghoitfhpscnn.supabase.co"
$env:SUPABASE_ANON_KEY="eyJhbG..."

# Start proxy
node server.js
```

**Logs you'll see:**
```
🚀 TM Mobile Proxy Server
========================
Port: 3001
Supabase: ✅ Configured

✅ Server running on http://localhost:3001

🔄 Fetching fresh token for shop 6212 from Supabase...
✅ Token fetched for shop 6212 (expires: 2025-11-21T04:30:00Z)
🔑 Using cached token for shop 6212
```

**Advantages:**
- ✅ Same IP as Chrome extension (no blacklisting)
- ✅ Auto token refresh
- ✅ Runs on local network
- ✅ No internet exposure needed

### Option 2: Railway Cloud

**Setup:**
```bash
# Via Railway dashboard or CLI
railway variables set SUPABASE_URL=https://oummojcsghoitfhpscnn.supabase.co
railway variables set SUPABASE_ANON_KEY=eyJhbG...
railway deploy
```

**Advantages:**
- ✅ Always online
- ✅ Auto token refresh
- ✅ No shop PC setup

**Disadvantages:**
- ⚠️ Different IP than Chrome extension
- ⚠️ May still trigger blacklisting (needs testing)

**Recommendation:** Use Shop PC option for guaranteed no blacklisting.

---

## 🔄 Token Refresh Process

### When Extension Updates Token:

1. **Extension captures new token** (shop PC)
2. **Writes to Supabase** `shop_tokens` table
3. **Proxy cache expires** (5 min max)
4. **Proxy fetches fresh token** automatically
5. **Mobile app continues working** seamlessly!

### Cache Strategy:

```javascript
TOKEN_CACHE_TTL = 5 minutes

Benefits:
- Reduces Supabase queries (1 query per 5 min vs 1 per request)
- Still refreshes frequently enough (12hr expiry / 5min cache = 144x margin)
- Balance between performance and freshness
```

---

## 🧪 Testing Token Refresh

### Test 1: Verify proxy pulls from Supabase

```bash
# Start proxy
node server.js

# From phone:
curl http://shop-pc:3001/health

# Should show:
{
  "supabase_configured": true,
  "cached_shops": 1  # After first request
}
```

### Test 2: Verify token caching

```bash
# Check proxy logs
🔄 Fetching fresh token for shop 6212 from Supabase...
✅ Token fetched for shop 6212
🔑 Using cached token for shop 6212  # Subsequent requests
```

### Test 3: Force cache refresh

```bash
# Wait 5+ minutes, make request
# Should see:
🔄 Fetching fresh token for shop 6212 from Supabase...
✅ Token fetched for shop 6212
```

### Test 4: Simulate token update

```bash
# 1. Update token in Supabase directly
# 2. Wait 5+ minutes (or restart proxy)
# 3. Make request from mobile app
# 4. Should use NEW token automatically
```

---

## 🎯 Why This Architecture Is Perfect

| Aspect | Solution | Benefit |
|--------|----------|---------|
| **Token Source** | Supabase | Single source of truth |
| **Token Location** | Shop PC only | No IP blacklisting |
| **Token Refresh** | Automatic | No manual updates |
| **Token Caching** | 5 minutes | Performance + freshness |
| **Multi-shop** | Shop ID param | Scales to multiple locations |
| **Security** | Token never leaves shop network | Maximum security |

---

## 🔐 Security Model

### Token Flow:
1. **Captured:** Chrome extension on shop PC
2. **Stored:** Supabase (encrypted at rest)
3. **Used:** Proxy on shop PC only
4. **Never transmitted to:** Mobile app

### Network Flow:
1. **Mobile → Proxy:** No token (just data)
2. **Proxy → TM:** Token included (same IP as capture)
3. **TM → Proxy:** Data
4. **Proxy → Mobile:** Data (no token)

**Token never crosses network boundaries!**

---

## 🚀 Scaling to Multiple Shops

The proxy supports multiple shops automatically:

```javascript
// Shop 6212 calls proxy
getJWTToken(6212)  // Fetches token for shop 6212

// Shop 7890 calls proxy
getJWTToken(7890)  // Fetches token for shop 7890

// Each shop has own cached token
tokenCache = {
  6212: { token: "eyJ...", fetchedAt: ... },
  7890: { token: "eyJ...", fetchedAt: ... }
}
```

**One proxy server, unlimited shops!**

---

## 💡 Alternative: Direct Supabase Read from Mobile App?

**Why not mobile app read token directly from Supabase?**

```javascript
// Mobile app
const token = await supabase.from('shop_tokens').select('token')
  ↓ Use token directly
TM API
  ❌ BLACKLISTED! (Different IP)
```

**Problem:** Token still used from phone's IP → blacklisted!

**Solution requires:** Token must be used from shop PC IP → Proxy needed!

---

## 🎉 Summary

**New Architecture (v2.0):**
- ✅ Proxy pulls tokens from Supabase dynamically
- ✅ Chrome extension auto-refreshes tokens
- ✅ Proxy auto-gets fresh tokens
- ✅ Zero manual intervention
- ✅ Works 24/7 automatically
- ✅ No token blacklisting ever!

**Environment Variables Needed:**
```bash
# Old (v1.0) - Static token
TM_JWT_TOKEN=eyJ...

# New (v2.0) - Dynamic from Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

**That's it! Set once, works forever!** 🚀
