
# http-tcp-packets

Send and receive data over an upgraded http connection

## Server side

```javascript
var packets = require('http-tcp-packets');
var http = require('http');

// Create http server
var srv = http.createServer( (req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('okay');
});

var packetServer = new packets.Server();

// Attach upgrade listener
srv.on('upgrade', (req, socket, head) => {
    packetServer.handleUpgrade(socket, (conn) => {

        conn.send('hello client');

        conn.on('data', (data) => {
            console.log(data);
        });
    });
});

srv.listen(8080, '127.0.0.1', () => {
    console.log('listening');
});
```

## Client side

```javascript
var packets = require('http-tcp-packets');

var packetClient = new packets.Client();

packetClient.connect('http://127.0.0.1:8080', function (err, conn) {

    if (err) {
        return console.error(err);
    }

    conn.send('hello server');

    conn.on('data', (data) => {
        console.log(data);
    });
});
```
