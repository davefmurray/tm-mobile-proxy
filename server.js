#!/usr/bin/env node

/**
 * TM Mobile Proxy Server
 *
 * Runs on shop PC to proxy requests from mobile app to Tekmetric API.
 * Prevents JWT token blacklisting by keeping token on original device.
 *
 * ZERO dependencies - uses only Node.js built-in modules!
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const PORT = process.env.PORT || 3001;
const TM_BASE_URL = 'https://shop.tekmetric.com';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Token cache: { shopId: { token, fetchedAt, expiresAt } }
const tokenCache = {};

console.log('🚀 TM Mobile Proxy Server');
console.log('========================');
console.log(`Port: ${PORT}`);
console.log(`Supabase: ${SUPABASE_URL ? '✅ Configured' : '❌ Missing'}`);
console.log(`Allowed Origins: ${ALLOWED_ORIGINS.join(', ')}`);
console.log('');

// Helper: Get JWT token from Supabase (with caching)
async function getJWTToken(shopId) {
  // Check cache first (refresh every 5 minutes)
  const cached = tokenCache[shopId];
  if (cached && Date.now() - cached.fetchedAt < TOKEN_CACHE_TTL) {
    console.log(`🔑 Using cached token for shop ${shopId}`);
    return cached.token;
  }

  console.log(`🔄 Fetching fresh token for shop ${shopId} from Supabase...`);

  try {
    const url = new URL('/rest/v1/shop_tokens', SUPABASE_URL);
    url.searchParams.set('shop_id', `eq.${shopId}`);
    url.searchParams.set('select', 'jwt_token,expires_at');

    const response = await new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      }, resolve);

      req.on('error', reject);
      req.end();
    });

    let data = '';
    response.on('data', chunk => data += chunk);

    await new Promise((resolve) => response.on('end', resolve));

    const tokens = JSON.parse(data);

    if (!tokens || tokens.length === 0) {
      console.error(`❌ No token found for shop ${shopId}`);
      return null;
    }

    const tokenData = tokens[0];
    const token = tokenData.jwt_token;
    const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at) : null;

    // Check if token is expired
    if (expiresAt && expiresAt < new Date()) {
      console.warn(`⚠️  Token for shop ${shopId} is expired! Extension should refresh it.`);
    }

    // Cache the token
    tokenCache[shopId] = {
      token,
      fetchedAt: Date.now(),
      expiresAt
    };

    console.log(`✅ Token fetched for shop ${shopId} (expires: ${expiresAt ? expiresAt.toISOString() : 'unknown'})`);
    return token;

  } catch (error) {
    console.error(`❌ Error fetching token for shop ${shopId}:`, error.message);
    return null;
  }
}

// Helper: Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper: Forward request to TM API
function proxyToTM(tmPath, method, body, jwtToken, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(tmPath, TM_BASE_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': jwtToken,
        'accept': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

// Helper: Send JSON response
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Helper: Handle CORS preflight
function handleCORS(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }
  return false;
}

// Main HTTP server
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (handleCORS(req, res)) return;

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  console.log(`${new Date().toISOString()} ${req.method} ${path}`);

  try {
    // Health check
    if (path === '/' || path === '/health') {
      return sendJSON(res, 200, {
        status: 'healthy',
        service: 'tm-mobile-proxy',
        version: '2.0.0',
        supabase_configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
        cached_shops: Object.keys(tokenCache).length,
        uptime: process.uptime()
      });
    }

    // Supabase validation
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return sendJSON(res, 503, {
        error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
      });
    }

    // Route: Get inspections
    if (path === '/api/get-inspections' && req.method === 'GET') {
      const shopId = url.searchParams.get('shopId');
      const roNumber = url.searchParams.get('roNumber');

      if (!shopId || !roNumber) {
        return sendJSON(res, 400, { error: 'Missing shopId or roNumber' });
      }

      // Get JWT token from Supabase
      const jwtToken = await getJWTToken(shopId);
      if (!jwtToken) {
        return sendJSON(res, 503, { error: 'No JWT token available for this shop' });
      }

      // Get RO by ID (roNumber is actually the RO ID from URL)
      const roResponse = await proxyToTM(
        `/api/shop/${shopId}/repair-order/${roNumber}`,
        'GET',
        null,
        jwtToken
      );

      if (roResponse.status !== 200) {
        return sendJSON(res, roResponse.status, { error: `RO not found (ID: ${roNumber})` });
      }

      const ro = JSON.parse(roResponse.body);

      // Get inspections using plural endpoint
      const inspectionResponse = await proxyToTM(
        `/api/shop/${shopId}/repair-orders/${ro.id}/inspections`,
        'GET',
        null,
        jwtToken
      );

      if (inspectionResponse.status !== 200) {
        return sendJSON(res, inspectionResponse.status, { error: 'Failed to fetch inspections' });
      }

      const inspections = JSON.parse(inspectionResponse.body);
      const tasks = [];

      // Flatten inspection tasks (TM uses different structure)
      for (const inspection of inspections) {
        if (inspection.inspectionTasks) {
          for (const taskGroup of inspection.inspectionTasks) {
            if (taskGroup.tasks) {
              for (const task of taskGroup.tasks) {
                tasks.push({
                  id: task.id,
                  inspectionId: inspection.id,
                  name: task.name,
                  group: task.inspectionGroup || taskGroup.title,
                  currentRating: task.inspectionRating,
                  currentFinding: task.finding
                });
              }
            }
          }
        }
      }

      return sendJSON(res, 200, {
        roId: ro.id,
        roNumber: ro.repairOrderNumber,
        customer: ro.customer?.firstName + ' ' + ro.customer?.lastName,
        vehicle: `${ro.vehicle?.year} ${ro.vehicle?.make} ${ro.vehicle?.model}`,
        tasks
      });
    }

    // Route: Upload video (presigned URL request)
    if (path === '/api/upload-video/presigned' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, fileName, fileType, shopId } = body;

      if (!roId || !inspectionId || !itemId || !shopId) {
        return sendJSON(res, 400, { error: 'Missing required fields (need shopId)' });
      }

      // Get JWT token from Supabase
      const jwtToken = await getJWTToken(shopId);
      if (!jwtToken) {
        return sendJSON(res, 503, { error: 'No JWT token available for this shop' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}/media`,
        'POST',
        {
          mediaType: 'VIDEO',
          fileType: fileType || 'video/webm',
          fileName: fileName || `inspection-${Date.now()}.webm`
        },
        jwtToken
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Confirm video upload
    if (path === '/api/upload-video/confirm' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, mediaId, shopId } = body;

      if (!roId || !inspectionId || !itemId || !mediaId || !shopId) {
        return sendJSON(res, 400, { error: 'Missing required fields (need shopId)' });
      }

      // Get JWT token from Supabase
      const jwtToken = await getJWTToken(shopId);
      if (!jwtToken) {
        return sendJSON(res, 503, { error: 'No JWT token available for this shop' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}/media/${mediaId}/confirm`,
        'POST',
        null,
        jwtToken
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Update inspection item (rating + finding)
    if (path === '/api/update-inspection-item' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, rating, finding, shopId } = body;

      if (!roId || !inspectionId || !itemId || !shopId) {
        return sendJSON(res, 400, { error: 'Missing required fields (need shopId)' });
      }

      // Get JWT token from Supabase
      const jwtToken = await getJWTToken(shopId);
      if (!jwtToken) {
        return sendJSON(res, 503, { error: 'No JWT token available for this shop' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}`,
        'PUT',
        { rating, finding },
        jwtToken
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Generic proxy (for any TM API endpoint)
    if (path.startsWith('/api/tm/')) {
      const shopId = url.searchParams.get('shopId');
      if (!shopId) {
        return sendJSON(res, 400, { error: 'Missing shopId parameter' });
      }

      // Get JWT token from Supabase
      const jwtToken = await getJWTToken(shopId);
      if (!jwtToken) {
        return sendJSON(res, 503, { error: 'No JWT token available for this shop' });
      }

      const tmPath = path.replace('/api/tm', '/api');
      const body = req.method !== 'GET' ? await parseBody(req) : null;

      const result = await proxyToTM(tmPath, req.method, body, jwtToken);

      res.writeHead(result.status, {
        'Content-Type': result.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(result.body);
      return;
    }

    // 404
    return sendJSON(res, 404, { error: 'Not found' });

  } catch (error) {
    console.error('Error:', error);
    return sendJSON(res, 500, {
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📱 Mobile app should connect to:');
  console.log(`   http://<shop-pc-ip>:${PORT}`);
  console.log('');
  console.log('🔑 To set JWT token:');
  console.log('   TM_JWT_TOKEN=your_token node server.js');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
