// Somente para drills: SMTP sem relay, mensagens em memória, rede Docker interna.
import net from 'node:net';
import http from 'node:http';
const messages = [];
net
  .createServer((socket) => {
    let pending = '';
    let message = null;
    socket.write('220 local recovery sink\r\n');
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      if (pending.length > 1024 * 1024) return socket.destroy();
      let end;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (message !== null) {
          if (line === '.') {
            messages.push(message.join('\r\n'));
            message = null;
            socket.write('250 captured locally\r\n');
          } else message.push(line.replace(/^\.\./u, '.'));
        } else if (/^DATA$/iu.test(line)) {
          message = [];
          socket.write('354 end with dot\r\n');
        } else if (/^QUIT$/iu.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  })
  .listen(1025, '0.0.0.0');
http
  .createServer((req, res) => {
    if (req.url !== '/messages' || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(messages));
  })
  .listen(8025, '0.0.0.0');
