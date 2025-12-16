const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const { Server } = require('socket.io');
const net = require('net');
const url = require('url');
const tls = require('tls');
const { generateFakeCert } = require('./certUtils');

// Configuration
const DASHBOARD_PORT = 3000;
const PROXY_PORT = 8082;
const INTERNAL_HTTPS_PORT = 8443; // Virtual internal server port

// --- Dashboard Server ---
const app = express();
const dashboardServer = http.createServer(app);
const io = new Server(dashboardServer);

app.use(express.static(path.join(__dirname, '../public')));

io.on('connection', (socket) => {
    // Client connected
});

function logTraffic(method, reqUrl, type) {
    const logEntry = {
        method,
        url: reqUrl,
        type,
        timestamp: new Date().toISOString()
    };
    io.emit('log', logEntry);
    console.log(`[${type}] ${method} ${reqUrl}`);
}

dashboardServer.listen(DASHBOARD_PORT, '0.0.0.0', () => {
    console.log(`Dashboard running on http://0.0.0.0:${DASHBOARD_PORT}`);
});


// --- Internal HTTPS Server (MITM) ---
// This server receives the decrypted traffic, logs it, and forwards it to the real destination.

const internalHttpsServer = https.createServer({
    SNICallback: (domain, cb) => {
        try {
            const { key, cert } = generateFakeCert(domain);
            const ctx = tls.createSecureContext({ key, cert });
            cb(null, ctx);
        } catch (err) {
            console.error('Error generating cert for SNI:', err);
            cb(err);
        }
    }
}, (req, res) => {
    const targetUrl = new URL(req.url, `https://${req.headers.host}`);

    logTraffic(req.method, targetUrl.toString(), 'HTTPS-DECRYPTED');

    const proxyReq = https.request(targetUrl, {
        method: req.method,
        headers: req.headers,
        rejectUnauthorized: false // We trust the upstream for now (or could be strict)
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('HTTPS Forwarding Error:', err);
        res.statusCode = 502;
        res.end('Bad Gateway');
    });

    req.pipe(proxyReq);
});

internalHttpsServer.listen(INTERNAL_HTTPS_PORT, '127.0.0.1', () => {
    console.log(`Internal MITM HTTPS Server running on 127.0.0.1:${INTERNAL_HTTPS_PORT}`);
});


// --- Main Proxy Server ---
const proxyServer = http.createServer((req, res) => {
    // Handle standard HTTP requests
    logTraffic(req.method, req.url, 'HTTP');

    const parsedUrl = url.parse(req.url);
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.path,
        method: req.method,
        headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('HTTP Proxy Error:', err);
        res.statusCode = 502;
        res.end('Bad Gateway');
    });

    req.pipe(proxyReq);
});

// Handle HTTPS CONNECT
proxyServer.on('connect', (req, clientSocket, head) => {
    const { port, hostname } = url.parse(`//${req.url}`, false, true);

    logTraffic('CONNECT', req.url, 'HTTPS-INIT');

    // Connect to our internal MITM server
    // We treat the internal server as the destination for the tunnel
    const proxySocket = net.connect(INTERNAL_HTTPS_PORT, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

        // Pipe the client's SSL handshake to our internal server
        // The internal server will see the SNI and generate the cert
        proxySocket.write(head);
        clientSocket.pipe(proxySocket).pipe(clientSocket);
    });

    proxySocket.on('error', (err) => {
        console.error('Proxy Socket Error:', err);
        clientSocket.end();
    });

    clientSocket.on('error', (err) => {
        console.error('Client Socket Error:', err);
        proxySocket.end();
    });
});

proxyServer.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`D-TECH Proxy running on 0.0.0.0:${PROXY_PORT}`);
});
