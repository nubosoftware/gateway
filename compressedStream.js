"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const { Readable, Duplex } = require('stream');
const zlib = require('zlib');

class CompressedStream extends Readable {
    /**
     *
     * @param {Readable} readable  - Source readble
     * @param {*} options
     */
    constructor(readable, options) {
        super(options);
        //logger.info(`constructor. readable: ${readable}, Readable: ${readable instanceof Readable}`);
        this.stream = readable;
        this.compressedInput = false;
        const cs = this;

        const finishHandler = () => {
            logger.info(`finishHandler()`);
            removeListeners();
            cs._closed = true;
            cs.emit('close');
        };

        const closeHandler = () => {
            logger.info(`closeHandler()`);
            removeListeners();
            cs._closed = true;
            cs.emit('close');
        };

        /*const drainHandler = () => {
            logger.info(`drainHandler()`);
            //removeListeners();
            cs.emit('drain');
        };*/

        const errorHandler = (err) => {
            logger.error(`errorHandler()`, err);
            //removeListeners();
            cs._err = err;
            //cs.emit('error', err);
        };

        const removeListeners = () => {
            cs.stream.removeListener("close", closeHandler);
            cs.stream.removeListener("error", errorHandler);
            //cs.stream.removeListener("drain", drainHandler);
            cs.stream.removeListener("finish", finishHandler);
        }

        this.stream.on("close", closeHandler);
        //this.stream.on("drain", drainHandler);
        this.stream.on("error", errorHandler);
        this.stream.on("finish", finishHandler);
    }

    /*_write(chunk, encoding, callback) {
        const cr = this;
        if (!this.compressedOutput) {
            //logger.info(`_write(), encoding: ${encoding}, callback: ${callback}`);
            try {
                cr.stream.write(chunk, encoding, function(err) {
                    //logger.info("this.stream.write callback...  err: " + err);
                    callback(err);
                });
            } catch (err) {
                logger.info(`write error: ${err}`);
                callback(err);
            }

        } else {
            if (this.doNotCompressChunk) {
                const buf = Buffer.alloc(5);
                buf.writeUInt8(0);
                buf.writeUInt32BE(chunk.length, 1);
                try {
                    this.stream.write(buf);
                    this.stream.write(chunk, encoding, callback);
                } catch (err) {
                    logger.info(`write error: ${err}`);
                    callback(err);
                }
                //logger.info(`write compress stream di: 0, len: ${chunk.length}, chunk: ${(chunk.length < 50 ? chunk.toString('hex') : "")}`);
            } else {
                zlib.deflate(chunk, (err, deflatted) => {
                    if (err) {
                        if (callback) {
                            callback(err);
                        }
                    } else {
                        const buf = Buffer.alloc(5);
                        buf.writeUInt8(1);
                        buf.writeUInt32BE(deflatted.length, 1);
                        try {
                            this.stream.write(buf);
                            this.stream.write(deflatted, callback);
                        } catch (err) {
                            logger.info(`write error: ${err}`);
                            callback(err);
                        }
                        //logger.info(`write compress stream di: 1, len: ${deflatted.length}, source len: ${chunk.length}`);
                    }
                });
            }
        }
    }*/

    _read(size) {
        if (this.DEBUG) logger.info(`_read start. stream: ${this.stream}, compressedInput: ${this.compressedInput}`);
        const cr = this;
        const readableHandler = () => {
            if (this.DEBUG) logger.info(`readableHandler`);
            let canPush = true;
            let needMoreData = false;
            while (canPush && !cr._err && !cr.closed) {

                if (!cr.compressedInput) {
                    //if (this.DEBUG) logger.info(`_read. before cr.stream.read()`);
                    let b = cr.stream.read();
                    //if (this.DEBUG) logger.info(`readable: ${b}`);
                    if (b) {
                        canPush = cr.push(b);
                        //if (this.DEBUG) logger.info(`pushed. canPush: ${canPush}`);
                    } else {
                        break;
                    }
                } else {
                    let b;
                    if (cr.waitReadBlock) {
                        b = cr.waitReadBlock;
                        delete cr.waitReadBlock;
                    } else {
                        b = cr.stream.read(5);
                    }
                    if (b) {
                        const di = b.readUInt8();
                        const len = b.readUInt32BE(1);
                        //logger.info(`Trying to read ${len} bytes. di: ${di}`);
                        let content = cr.stream.read(len);
                        //logger.info(`After read content: ${content != null}`);
                        if (content) {
                            if (di == 1) { //defalted stream
                                //logger.info(`Before zlib`);
                                zlib.inflate(content, (err, inflated) => {
                                    if (err) {
                                        logger.error(`Error inflate`, err);
                                        cr.destroy(err);
                                        return;
                                    }
                                    //logger.info(`Before push`);
                                    cr.push(inflated);
                                    //logger.info(`pushed inflated.`);
                                });
                            } else {
                                // not defalted stream - return chunk
                                canPush = cr.push(content);
                                //logger.info(`pushed. canPush: ${canPush}`);
                            }
                        } else {
                            logger.info(`Buffer not read with ${len} bytes. Return header (5 bytes) to stream`);
                            //cr.stream.unshift(b); // return header if not have all data
                            cr.waitReadBlock = b;
                            needMoreData = true;
                            break;
                        }
                    } else {
                        break;
                    }

                }
            }
            //logger.info(`Loop finished.  canPush: ${canPush}, cr._err: ${cr._err}, cr.closed: ${cr.closed}, needMoreData: ${needMoreData}`);
            if (!needMoreData) {
                removeListeners();
            }

        };


        const closeHandler = () => {
            removeListeners();
            logger.info(`_read closeHandler`);
        };

        const endHandler = () => {
            removeListeners();
            //logger.info(`endHandler`);
        };

        const errorHandler = (err) => {
            removeListeners()
            logger.error(`_read errorHandler`, err);
        };
        const removeListeners = () => {
            cr.stream.removeListener("close", closeHandler);
            cr.stream.removeListener("error", errorHandler);
            cr.stream.removeListener("end", endHandler);
            cr.stream.removeListener("readable", readableHandler);
        }
        cr.stream.on("close", closeHandler)
        cr.stream.on("end", endHandler)
        cr.stream.on("error", errorHandler)
        cr.stream.on('readable', readableHandler);

    }
}

module.exports = CompressedStream;