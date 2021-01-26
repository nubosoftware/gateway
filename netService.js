"use strict";


const net = require('net');
const tls = require('tls');
const Common = require('./common.js');
const logger = Common.logger(__filename);
const NetConn = require('./netConn');

class NetService {


    constructor(port, connClass, tlsOptions) {
        this.port = port;
        this.tlsOptions = tlsOptions;
        this.connClass = connClass;
        if (tlsOptions) {
            this.server = tls.createServer(tlsOptions);
            this.serverType = "tls";
        } else {
            this.server = net.createServer();
            this.serverType = "tcp";
        }
        this.TAG = `${this.serverType}_${this.port}`;


        const cs = this;

        this.server.on('connection', (socket) => {
            cs.onConnection(socket);
        });
        this.server.on('close', () => {
            cs.onClose();
        });
        this.server.on('error', (error) => {
            cs.onError(error);
        });

        this.server.on('listening', () => {
            if (this.waitPromise) {
                this.waitPromise.resolve();
                this.waitPromise = null;
            }
        });

        logger.info(`${this.TAG}: Create ${this.serverType} server on port ${this.port}`);
    }

    listen() {
        const ns = this;
        this.server.listen(this.port);
        return new Promise((resolve, reject) => {
            ns.waitPromise = {
                resolve,
                reject
            };
        });
    }

    onConnection(socket) {
        //logger.info(`${this.TAG}: handleConnection. remoteAddress: ${socket.remoteAddress}`);
        const netConn = new this.connClass(socket);
        const errorHandler = (err) => {
            logger.info(`${this.TAG}: connection error`, err);
        };
        const closeHandler = (err) => {
            logger.info(`${this.TAG}: connection closed`);
            socket.end();
        };
        netConn.on("error", errorHandler);
        netConn.on("close", closeHandler)
    }

    onClose() {
        logger.info(`${this.TAG}: onClose`);
        /*if (this.waitPromise) {
            this.waitPromise.resolve();
        }*/
    }

    onError(error) {
        logger.error(`${this.TAG}: error`, error);
        if (this.waitPromise) {
            this.waitPromise.reject(error);
            this.waitPromise = null;
        }
    }


}

module.exports = NetService;