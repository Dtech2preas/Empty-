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
const io = new Server(dashboardServer, {
    transports: ['polling'],
    allowUpgrades: false
});

app.use(express.static(path.join(__dirname, '../public')));

io.on('connection', (socket) => {
    // Client connected
});

app.get('/cert', (req, res) => {
    const certPath = path.join(__dirname, '../certs/rootCA.pem');
    res.download(certPath, 'D-TECH-Root-CA.pem');
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
    let requestOptions = {};
    let urlForLogging = "";

    try {
        // Method 1: Try to build a standard URL object
        const targetUrlObj = new URL(req.url, `https://${req.headers.host}`);
        urlForLogging = targetUrlObj.toString();
        
        // If successful, use the URL object and merge options
        requestOptions = {
            hostname: targetUrlObj.hostname,
            port: targetUrlObj.port || 443,
            path: targetUrlObj.pathname + targetUrlObj.search,
            method: req.method,
            headers: req.headers,
            rejectUnauthorized: false
        };

    } catch (err) {
        // Method 2: Fallback for weird URLs (like //v1:checkClientOptions)
        // We manually construct options to prevent https.request from crashing
        console.warn('Invalid URL encountered, using Manual Mode:', req.url);
        urlForLogging = req.url;

        const hostHeader = req.headers.host || "";
        const [hostname, port] = hostHeader.split(':');

        requestOptions = {
            hostname: hostname,
            port: port || 443,
            path: req.url, // Send the raw weird path exactly as received
            method: req.method,
            headers: req.headers,
            rejectUnauthorized: false
        };
    }

    logTraffic(req.method, urlForLogging, 'HTTPS-DECRYPTED');

    // Make the request using the safe options object
    const proxyReq = https.request(requestOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('HTTPS Forwarding Error:', err);
        // Don't crash, just end the response
        if (!res.headersSent) {
            res.statusCode = 502;
            res.end('Bad Gateway');
        }
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
        if (!res.headersSent) {
            res.statusCode = 502;
            res.end('Bad Gateway');
        }
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
