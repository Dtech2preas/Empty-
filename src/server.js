const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const express = require('express');
const { Server } = require('socket.io');
const { generateFakeCert, CA_CERT_PATH } = require('./certUtils');

const PROXY_PORT = 8080;
const DASHBOARD_PORT = 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log(':: Dashboard Connected ::');
});

server.listen(DASHBOARD_PORT, () => {
    console.log(`[D-TECH] Dashboard running at http://localhost:${DASHBOARD_PORT}`);
});

const requestHandler = (req, res) => {
    const parsedUrl = url.parse(req.url);
    console.log(`[HTTP] ${req.method} ${parsedUrl.hostname}`);
    io.emit('log', { method: req.method, url: req.url, type: 'HTTP' });

    const proxyReq = http.request(req.url, {
        method: req.method,
        headers: req.headers
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    req.pipe(proxyReq);
};

const proxyServer = http.createServer(requestHandler);

proxyServer.on('connect', (req, clientSocket, head) => {
    const { port, hostname } = url.parse(`//${req.url}`, false, true);
    console.log(`[HTTPS] Intercepting: ${hostname}`);
    io.emit('log', { method: 'CONNECT', url: hostname, type: 'HTTPS-INIT' });

    const fakeCert = generateFakeCert(hostname);
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const virtualServer = https.createServer({
        key: fakeCert.key,
        cert: fakeCert.cert
    }, (vReq, vRes) => {
        io.emit('log', { method: vReq.method, url: `https://${hostname}${vReq.url}`, type: 'HTTPS-DECRYPTED' });

        const upstreamReq = https.request({
            hostname: hostname,
            port: 443,
            path: vReq.url,
            method: vReq.method,
            headers: vReq.headers
        }, (upstreamRes) => {
            vRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            upstreamRes.pipe(vRes);
        });

        vReq.pipe(upstreamReq);
    });

    virtualServer.emit('connection', clientSocket);
});

proxyServer.listen(PROXY_PORT, () => {
    console.log(`[D-TECH] Proxy Interceptor running on PORT ${PROXY_PORT}`);
    console.log(`>> Root CA Path: ${CA_CERT_PATH}`);
});
