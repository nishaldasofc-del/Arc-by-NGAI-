const https = require('https');

const req = https.request('https://zenoai-1.onrender.com/api/v1/session/new', { method: 'POST' }, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Data:', data));
});
req.on('error', console.error);
req.end();
