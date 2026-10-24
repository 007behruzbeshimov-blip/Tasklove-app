const http = require('http');
const server = http.createServer((req, res) => {
  console.log('Request:', req.method, req.url);
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({ok: true}));
});
server.listen(3000, '0.0.0.0', () => console.log('Test server listening on 3000'));