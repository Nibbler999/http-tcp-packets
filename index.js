'use strict';

var stream = require('stream');
var util = require('util');
var http = require('http');
var https = require('https');
var url = require('url');

var nextTick = require('process-nextick-args');

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

    if (typeof opts === 'string') {
        opts = url.parse(opts);
    }

    opts.headers = opts.headers || {};

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

    stream.Duplex.call(this, { objectMode: true });

    this._missing = 0;
    this._message = null;
    this._flags = 0;
    this._limit = opts && opts.limit || 0;
    this._prefix = new Array(8);
    this._ptr = 0;
    this.socket = socket;

    socket.setNoDelay();

    socket.on('data', onData.bind(this));
    socket.on('end', onEnd.bind(this));
    socket.on('error', onError.bind(this));
};

util.inherits(Wrap, stream.Duplex);

Wrap.prototype._push = function (message) {
    this._ptr = 0;
    this._missing = 0;
    this._message = null;

    if (this._flags & 1) {
        message = message.toString();
    }

    this._flags = 0;

    if (!this.push(message)) {
        this.socket.pause();
    }
}

Wrap.prototype._prefixError = function (data) {
    this.emit('error', new Error('Message is larger than max length'));
    this.socket.destroy();
    return data.length;
}

Wrap.prototype._parseLength = function (data, offset) {

    for (offset; offset < data.length; offset++) {
        if (this._ptr >= this._prefix.length) return this._prefixError(data)
        this._prefix[this._ptr++] = data[offset]
        if (this._ptr === 8) {
            this._missing = Buffer.prototype.readUInt32BE.call(this._prefix, 0, true)
            this._flags = Buffer.prototype.readUInt32BE.call(this._prefix, 4, true)
            if (this._missing === 0) return this._push(this._flags & 1 ? '' : new Buffer(0))
            if (this._limit && this._missing > this._limit) return this._prefixError(data)
            if ((this._flags & 1) && this._missing > (1 << 28) - 16) return this._prefixError(data)
            this._ptr = 0
            return offset + 1
        }
    }

    return data.length
}

Wrap.prototype._parseMessage = function (data, offset) {
    var free = data.length - offset
    var missing = this._missing

    if (!this._message) {
        if (missing <= free) { // fast track - no copy
            this._push(data.slice(offset, offset + missing))
            return offset + missing
        }
        this._message = new Buffer(missing)
    }

    data.copy(this._message, this._ptr, offset, offset + missing)

    if (missing <= free) {
        this._push(this._message)
        return offset + missing
    }

    this._missing -= free
    this._ptr += free

    return data.length
}

Wrap.prototype.end = function () {
    this.socket.end();
};

Wrap.prototype._read = function () {
    this.socket.resume();
};

Wrap.prototype._write = function (data, encoding, cb) {

    var flags = 0;

    if (typeof data === 'string') {
        data = new Buffer(data, encoding);
        flags |= 1;
    }

    this.socket.cork();

    this.socket.write(getPrefix(data.length, flags));
    this.socket.write(data, cb);

    nextTick(uncork, this.socket);
};

Wrap.prototype.writev = function (parts, cb) {

    var flags = 0;
    var length = 0;
    var i = 0;

    for (i = 0; i < parts.length; i++) {
       length += parts[i].length;
    }

    this.socket.cork();

    this.socket.write(getPrefix(length, flags));

    for (i = 0; i < parts.length - 1; i++) {
        this.socket.write(parts[i]);
    }

    this.socket.write(parts[parts.length - 1], cb);

    nextTick(uncork, this.socket);
};

function getPrefix (length, flags) {

    var prefix = new Buffer(8);
    prefix.writeUInt32BE(length, 0, true);
    prefix.writeUInt32BE(flags, 4, true);
    return prefix;
}

function uncork (socket) {
    socket.uncork();
}

function onData (data) {

    var offset = 0;

    while (offset < data.length) {
        if (this._missing) {
            offset = this._parseMessage(data, offset);
        } else {
            offset = this._parseLength(data, offset);
        }
    }
}

function onError (err) {
    this.emit('error', err);
}

function onEnd () {
    this.emit('end');
    this.socket.end();
}

module.exports.Server = Server;
module.exports.Client = Client;

