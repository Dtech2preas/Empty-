const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const pki = forge.pki;
const certDir = path.join(__dirname, '../certs');

if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);

const CA_KEY_PATH = path.join(certDir, 'rootCA.key');
const CA_CERT_PATH = path.join(certDir, 'rootCA.pem');

function getRootCA() {
    if (fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH)) {
        console.log('>> Loading existing D-TECH Root CA...');
        const certPem = fs.readFileSync(CA_CERT_PATH, 'utf8');
        const keyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
        return {
            cert: pki.certificateFromPem(certPem),
            key: pki.privateKeyFromPem(keyPem)
        };
    }

    console.log('>> Generating NEW D-TECH Root CA...');
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    const attrs = [
        { name: 'commonName', value: 'D-TECH Proxy CA' },
        { name: 'countryName', value: 'ZA' },
        { shortName: 'ST', value: 'GP' },
        { name: 'organizationName', value: 'D-TECH Dynamic Tech' },
        { shortName: 'OU', value: 'Security Research' }
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: true }]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    fs.writeFileSync(CA_KEY_PATH, pki.privateKeyToPem(keys.privateKey));
    fs.writeFileSync(CA_CERT_PATH, pki.certificateToPem(cert));

    return { cert, key: keys.privateKey };
}

function generateFakeCert(domain) {
    const ca = getRootCA();
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = new Date().getTime() + '';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    const attrs = [{ name: 'commonName', value: domain }];
    cert.setSubject(attrs);
    cert.setIssuer(ca.cert.subject.attributes);

    cert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: domain }] }
    ]);

    cert.sign(ca.key, forge.md.sha256.create());

    return {
        key: pki.privateKeyToPem(keys.privateKey),
        cert: pki.certificateToPem(cert)
    };
}

module.exports = { getRootCA, generateFakeCert, CA_CERT_PATH };
