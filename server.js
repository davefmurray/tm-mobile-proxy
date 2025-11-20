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
const JWT_TOKEN = process.env.TM_JWT_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

console.log('🚀 TM Mobile Proxy Server');
console.log('========================');
console.log(`Port: ${PORT}`);
console.log(`JWT Token: ${JWT_TOKEN ? '✅ Set' : '❌ Missing'}`);
console.log(`Allowed Origins: ${ALLOWED_ORIGINS.join(', ')}`);
console.log('');

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
function proxyToTM(tmPath, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(tmPath, TM_BASE_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': JWT_TOKEN,
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
        version: '1.0.0',
        jwt_configured: !!JWT_TOKEN,
        uptime: process.uptime()
      });
    }

    // JWT token validation
    if (!JWT_TOKEN) {
      return sendJSON(res, 503, {
        error: 'JWT token not configured. Set TM_JWT_TOKEN environment variable.'
      });
    }

    // Route: Get inspections
    if (path === '/api/get-inspections' && req.method === 'GET') {
      const shopId = url.searchParams.get('shopId');
      const roNumber = url.searchParams.get('roNumber');

      if (!shopId || !roNumber) {
        return sendJSON(res, 400, { error: 'Missing shopId or roNumber' });
      }

      // Get RO ID from RO number
      const roResponse = await proxyToTM(
        `/api/shop/${shopId}/repair-order?number=${roNumber}`,
        'GET'
      );

      if (roResponse.status !== 200) {
        return sendJSON(res, roResponse.status, { error: 'RO not found' });
      }

      const roData = JSON.parse(roResponse.body);
      const ro = roData.content?.[0];

      if (!ro) {
        return sendJSON(res, 404, { error: 'RO not found' });
      }

      // Get inspections
      const inspectionResponse = await proxyToTM(
        `/api/repair-order/${ro.id}/inspection`,
        'GET'
      );

      const inspections = JSON.parse(inspectionResponse.body);
      const tasks = [];

      // Flatten inspection items
      for (const inspection of inspections) {
        if (inspection.itemGroups) {
          for (const group of inspection.itemGroups) {
            if (group.items) {
              for (const item of group.items) {
                tasks.push({
                  id: item.id,
                  inspectionId: inspection.id,
                  name: item.name,
                  group: group.name,
                  currentRating: item.rating,
                  currentFinding: item.finding
                });
              }
            }
          }
        }
      }

      return sendJSON(res, 200, {
        roId: ro.id,
        customer: ro.customer?.firstName + ' ' + ro.customer?.lastName,
        vehicle: `${ro.vehicle?.year} ${ro.vehicle?.make} ${ro.vehicle?.model}`,
        tasks
      });
    }

    // Route: Upload video (presigned URL request)
    if (path === '/api/upload-video/presigned' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, fileName, fileType } = body;

      if (!roId || !inspectionId || !itemId) {
        return sendJSON(res, 400, { error: 'Missing required fields' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}/media`,
        'POST',
        {
          mediaType: 'VIDEO',
          fileType: fileType || 'video/webm',
          fileName: fileName || `inspection-${Date.now()}.webm`
        }
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Confirm video upload
    if (path === '/api/upload-video/confirm' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, mediaId } = body;

      if (!roId || !inspectionId || !itemId || !mediaId) {
        return sendJSON(res, 400, { error: 'Missing required fields' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}/media/${mediaId}/confirm`,
        'POST'
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Update inspection item (rating + finding)
    if (path === '/api/update-inspection-item' && req.method === 'POST') {
      const body = await parseBody(req);
      const { roId, inspectionId, itemId, rating, finding } = body;

      if (!roId || !inspectionId || !itemId) {
        return sendJSON(res, 400, { error: 'Missing required fields' });
      }

      const result = await proxyToTM(
        `/api/repair-order/${roId}/inspection/${inspectionId}/item/${itemId}`,
        'PUT',
        { rating, finding }
      );

      return sendJSON(res, result.status, JSON.parse(result.body));
    }

    // Route: Generic proxy (for any TM API endpoint)
    if (path.startsWith('/api/tm/')) {
      const tmPath = path.replace('/api/tm', '/api');
      const body = req.method !== 'GET' ? await parseBody(req) : null;

      const result = await proxyToTM(tmPath, req.method, body);

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
