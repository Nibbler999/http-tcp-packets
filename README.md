
# http-tcp-packets

Send and receive data packets over an upgraded http connection

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

        conn.write('hello client');

        conn.on('data', (data) => {
            console.log('%s', data);
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

var opts = {
    host: '127.0.0.1',
    port: 8080,
    headers: {
        foo: 'bar'
    }
};

packetClient.connect(opts, function (err, conn) {

    if (err) {
        return console.error(err);
    }

    conn.write('hello server');

    conn.on('data', (data) => {
        console.log('%s', data);
    });
});
```
