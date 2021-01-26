"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const net = require('net');
const { PromiseDuplex } = require("promise-duplex");
const CompressedStream = require('./compressedStream');
const EventEmitter = require('events');
const SequentialTaskQueue = require('sequential-task-queue').SequentialTaskQueue;

const COMPRESSION_BUFFER_SIZE = 64000;

class NetConn extends EventEmitter {

    /**
     * 
     * @param {net.Socket} socket 
     */
    constructor(socket) {
        super();
        this.socket = socket;
        this.TAG = `${this.__proto__.constructor.name}_${socket.remoteAddress}:${socket.remotePort}`;
        this.compressedStream = socket; //new CompressedStream(socket);
        this.compressedStream.compressedInput = false;
        this.compressedStream.compressedOutput = false;
        if (this.__proto__.constructor.name == "PlayerConn") this.compressedStream.DEBUG = true;
        this.compressedOutput = false;
        this.writeQ = new SequentialTaskQueue();
        const nc = this;

        const errorHandler = (err) => {
            logger.error(`${nc.TAG}. error on soccket`, err);
            nc._err = err;
            nc.emit('error', err);
            try {
                nc.socket.destroy();
            } catch (err) {

            }
        };

        const closeHandler = () => {
            logger.info(`${nc.TAG}. compressedStream closed`);
            nc.compressedStream.removeListener("error", errorHandler);
            nc.compressedStream.removeListener("close", closeHandler)
            nc.emit('close');
            try {
                nc.socket.destroy();
            } catch (err) {

            }
        }

        this.compressedStream.on("error", errorHandler);
        this.compressedStream.on("close", closeHandler)
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }


    /**
     * 
     * @param {*} size 
     * @returns {Buffer} chunk
     */
    readChunk(size) {
        const nc = this;
        let debug = false;
        if (this.__proto__.constructor.name == "PlayerConn") {
            //this.log(`readChunk. size: ${size}`);
            debug = true;
        }
        if (this.DEBUG) this.log(`readChunk. size: ${size}`);
        return new Promise((resolve, reject) => {
            if (nc._err) {
                reject(nc._err);
                return;
            }
            const readableHandler = () => {
                if (this.DEBUG) this.log(`readChunk. readableHandler`);
                //if (this.__proto__.constructor.name == "PlayerConn") this.log(`readChunk. readableHandler`);
                let chunk = nc.compressedStream.read(size);
                //if (this.__proto__.constructor.name == "PlayerConn") this.log(`readChunk. readableHandler. chunk: ${chunk}`);
                if (chunk) {
                    if (this.DEBUG) this.log(`readChunk. resolve: ${size}`);
                    removeListeners();
                    resolve(chunk);
                    return;
                }
            };
            const closeHandler = () => {
                if (debug) this.log("readChunk closeHandler");
                removeListeners();
                reject(new Error("Connection closed"))
            };

            const endHandler = () => {
                if (debug) this.log("readChunk endHandler");
                removeListeners();
                reject(new Error("Connection ended"))
            };

            const errorHandler = (err) => {
                if (debug) this.log("readChunk errorHandler: " + err);
                removeListeners()
                reject(err)
            };
            const removeListeners = () => {
                nc.compressedStream.removeListener("close", closeHandler);
                nc.compressedStream.removeListener("error", errorHandler);
                nc.compressedStream.removeListener("end", endHandler);
                nc.compressedStream.removeListener("readable", readableHandler);
            }
            nc.compressedStream.on("close", closeHandler)
            nc.compressedStream.on("end", endHandler)
            nc.compressedStream.on("error", errorHandler)
            nc.compressedStream.on('readable', readableHandler);
        });
    }

    async compressAndSend() {
        if (!this.compressArr || this.compressBuffPos == 0) {
            return;
        }

        const sendBuff = Buffer.from(this.compressArr.buffer, 0, this.compressBuffPos);
        this.compressedStream.compressedOutput = true;
        ///*if (this.DEBUG) {
        //this.log(`compressAndSend: this.compressBuffPos: ${this.compressBuffPos}, sendBuff : ${sendBuff.length}`);
        //}*/
        await this.writeChunkImp(sendBuff);
        this.compressBuffPos = 0;
    }


    /**
     * 
     * @param {Buffer} chunk 
     * @param {*} writeUnCompressed 
     */
    async writeChunk(chunk, writeUnCompressed) {
        if (this.compressedOutput) {
            if (!this.compressBuff) {
                this.compressArr = new Int8Array(COMPRESSION_BUFFER_SIZE);
                this.compressBuff = Buffer.from(this.compressArr.buffer);
                this.compressBuffPos = 0;
            }
            if (writeUnCompressed) {
                if (this.compressBuffPos > 0) {
                    // send preious compressed buffer
                    await this.compressAndSend();
                }
                this.compressedStream.doNotCompressChunk = true;
                return await this.writeChunkImp(chunk);
            } else {
                // write compress data
                this.compressedStream.doNotCompressChunk = false;
                if (this.compressBuffPos + chunk.length > COMPRESSION_BUFFER_SIZE) {
                    await this.compressAndSend();
                }
                if (chunk.length <= COMPRESSION_BUFFER_SIZE) {
                    chunk.copy(this.compressBuff, this.compressBuffPos);
                    this.compressBuffPos += chunk.length;
                    //this.log(`Add write data of size: ${chunk.length}. total buffer: ${this.compressBuffPos}`);
                } else {
                    this.log(`large buffer for compression. divide it`);
                    let cnt = 0;

                    while (cnt < chunk.length) {
                        const remains = (chunk.length - cnt);
                        let len = (remains > COMPRESSION_BUFFER_SIZE ? COMPRESSION_BUFFER_SIZE : remains);
                        chunk.copy(this.compressBuff, 0, cnt, len);
                        this.compressBuffPos = len;
                        this.log(`Sending ${len} bytes from offset ${cnt}`);
                        await this.compressAndSend();
                        cnt += len;
                    }
                }
            }
        } else {
            //this.log(`write chunk. size: ${chunk.length}, chunk: ${chunk.toString('hex')}`);
            return await this.writeChunkImp(chunk);
        }
    }

    writeChunkImp(chunk) {
        const nc = this;
        return new Promise((resolve, reject) => {
            if (nc._err) {
                reject(nc._err);
                return;
            }


            const writeHandler = () => {
                //logger.info(`${this.TAG}. writeHandler...`);
                removeListeners();
                resolve();
            };

            const closeHandler = () => {
                removeListeners()
                reject(new Error("Connection closed"))
            };

            const endHandler = () => {
                removeListeners()
                reject(new Error("Connection ended"))
            };

            const errorHandler = (err) => {
                removeListeners()
                reject(err)
            };

            const removeListeners = () => {
                nc.compressedStream.removeListener("close", closeHandler);
                nc.compressedStream.removeListener("error", errorHandler);
                nc.compressedStream.removeListener("end", endHandler);
            }
            nc.compressedStream.on("close", closeHandler);
            nc.compressedStream.on("end", endHandler);
            nc.compressedStream.on("error", errorHandler);
            nc.compressedStream.write(chunk, writeHandler);

        });
    }

    end() {
        const nc = this;
        return new Promise((resolve, reject) => {
            nc.socket.end(() => {
                resolve();
            });
        });
    }

    async readInt() {
        const chunk = await this.readChunk(4);
        return chunk.readInt32BE();
    }

    async readByte() {
        const chunk = await this.readChunk(1);
        return chunk.readInt8();
    }

    /**
     * @returns {boolean}
     */
    async readBoolean() {
        const b = await this.readByte();
        if (b != 0) {
            return true;
        } else {
            return false
        }
    }

    /**
     * @returns {number}
     */
    async readFloat() {
        const chunk = await this.readChunk(4);
        return chunk.readFloatBE();
    }

    /**
     * @returns {bigint}
     */
    async readLong() {
        const chunk = await this.readChunk(8);
        return chunk.readBigInt64BE();
    }

    /**
     * @returns {string}
     */
    async readUTF() {
        //if (this.DEBUG) this.log(`readUTF.`);
        const chunk = await this.readChunk(2);
        const strlen = chunk.readInt16BE();
        //if (this.DEBUG) this.log(`readUTF. strlen: ${strlen}`);
        if (strlen > 0) {
            const chunk2 = await this.readChunk(strlen);
            const text = chunk2.toString('utf8');
            return text;
        } else {
            return "";
        }
    }

    /**
     * @returns {string}
     */
    async readString() {
        //if (this.DEBUG) this.log("readString. reading boolean");
        const isNull = await this.readBoolean();
        //if (this.DEBUG) this.log(`readString. isNull: ${isNull}`);
        let text = null;
        if (!isNull) {
            text = await this.readUTF();
        }
        return text;
    }

    /**
     * @returns {Buffer} data
     */
    async readByteArr() {
        const len = await this.readInt();
        const data = await this.readChunk(len);
        return data;

    }

    async writeInt(num) {
        const b = Buffer.alloc(4);
        b.writeInt32BE(num);
        //logger.info(`${this.TAG}. writeInt: ${num}`);
        await this.writeChunk(b);
    }


    async writeBoolean(bool) {
        const b = Buffer.alloc(1);
        b.writeInt8(bool ? 1 : 0);
        await this.writeChunk(b);
    }

    /**
     * 
     * @param {string} str 
     */
    async writeString(str) {
            if (!str) {
                //this.log("Write null string..");
                await this.writeBoolean(true);
                return;
            }
            const strbuf = Buffer.from(str, 'utf8');
            let b = Buffer.alloc(3);
            //this.log(`Write string of size: ${strbuf.length}`);
            b.writeInt8(0)
            b.writeInt16BE(strbuf.length, 1);
            await this.writeChunk(b);
            await this.writeChunk(strbuf);
        }
        /**
         * 
         * @param {number} f 
         */
    async writeFloat(f) {
        const b = Buffer.alloc(4);
        b.writeFloatBE(f);
        await this.writeChunk(b);
    }

    /**
     * 
     * @param {bigint} num 
     */
    async writeLong(num) {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(num);
        //logger.info(`${this.TAG}. writeInt: ${num}`);
        await this.writeChunk(b);
    }
}

module.exports = NetConn;