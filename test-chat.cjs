const https = require('https');

const req = https.request('https://zenoai-1.onrender.com/api/v1/chat/stream', { 
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Data:', data));
});
req.on('error', console.error);
req.write(JSON.stringify({
  sessionId: 'f42ab1e9-3718-48c1-a490-57ec9b697124',
  message: 'Hello'
}));
req.end();
