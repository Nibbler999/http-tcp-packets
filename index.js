var varint = require('varint');
var stream = require('readable-stream');
var util = require('util');
var http = require('http');
var https = require('https');

var Decoder = require('length-prefixed-stream/decode');
var nextTick = require('process-nextick-args');

var pool = new Buffer(10 * 1024);
var used = 0;

var Server = function (opts) {
    this.opts = opts;

    this.header = ['HTTP/1.1 101 Switching Protocols',
      'Upgrade: http-tcp-packets',
      'Connection: Upgrade'].join('\r\n') + '\r\n\r\n';
};

Server.prototype.handleUpgrade = function (socket, cb) {

    socket.write(this.header);

    setImmediate(cb, new Wrap(socket, this.opts));
};

var Client = function() { };

Client.prototype.connect = function (opts, cb) {

    opts.headers['Connection'] = 'Upgrade';
    opts.headers['Upgrade'] = 'http-tcp-packets';

    var httpObj = opts.protocol === 'https:' ? https : http;

    var req = httpObj.get(opts);

    req.on('error', function error(err) {
        cb(err);
    });

    req.once('upgrade', function upgrade(res, socket, upgradeHead) {
        req.removeAllListeners('error');
        socket.unshift(upgradeHead);
        cb(null, new Wrap(socket));
    });
};

var Wrap = function (socket, opts) {

    if (!(this instanceof Wrap)) {
        return new Wrap(socket, opts);
    }

    stream.Duplex.call(this);

    var self = this;

    socket.setNoDelay();

    this.socket = socket;
    this.decode = new Decoder(opts);

    socket.pipe(this.decode);

    socket.on('error', function (err) {
        self.emit('error', err);
    });

    this.decode.on('error', function (err) {
        self.emit('error', err);
        socket.end();
    });

    this.decode.on('end', function () {
        self.emit('end');
        self.socket.destroy();
    });

    this.decode.on('data', function (data) {
        self.push(data);
    });
};

util.inherits(Wrap, stream.Duplex);

Wrap.prototype.end = function () {
    this.socket.end();
};

Wrap.prototype._read = function (n) {
    this.decode.read(n);
};

Wrap.prototype._write = function (data, encoding, cb) {
    this.socket.cork();
    this.socket.write(getVarintBytes(data.length));
    this.socket.write(data, cb);
    nextTick(uncork, this.socket);
};

Wrap.prototype.writeMultipart = function (parts, cb) {
    var length = 0;
    var i = 0;

    for (i = 0; i < parts.length; i++) {
        length += parts[i].length;
    }

    this.socket.cork();

    this.socket.write(getVarintBytes(length));

    for (i = 0; i < parts.length - 1; i++) {
        this.socket.write(parts[i]);
    }

    this.socket.write(parts[parts.length - 1], cb);

    nextTick(uncork, this.socket);
};

function getVarintBytes (length) {
    if (pool.length - used < 100) {
        pool = new Buffer(10 * 1024);
        used = 0;
    }

    varint.encode(length, pool, used);
    used += varint.encode.bytes;

    return pool.slice(used - varint.encode.bytes, used);
}

function uncork(socket) {
    socket.uncork();
}

module.exports.Server = Server;
module.exports.Client = Client;

