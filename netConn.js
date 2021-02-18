"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const net = require('net');
const { PromiseDuplex } = require("promise-duplex");
const CompressedStream = require('./compressedStream');
const EventEmitter = require('events');
const SequentialTaskQueue = require('sequential-task-queue').SequentialTaskQueue;
const zlib = require('zlib');


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
        this.compressedOutput = false;
        this.compressedInput = false;
        this.writeQ = new SequentialTaskQueue();

        const writeQErrorHandler = (err) => {
            logger.error(`${nc.TAG}.writeQ error: ${err}`);
        };
        this.writeQ.on("error", writeQErrorHandler);
        const nc = this;

        const errorHandler = (err) => {
            //logger.error(`${nc.TAG}. error on soccket`, err);
            nc._err = err;
            nc.emit('error', err);
        };

        const closeHandler = () => {
            //logger.info(`${nc.TAG}. socket closed`);

            nc.socket.removeListener("error", errorHandler);
            nc.socket.removeListener("close", closeHandler)
            nc.emit('close');
            /*try {
                nc.socket.destroy();
            } catch (err) {

            }*/
        }

        this.socket.on("error", errorHandler);
        this.socket.on("close", closeHandler)
    }

    log(msg) {
        if(this.email) {
            logger.info(`${this.TAG}: ${msg}`, {email: this.email});
        } else {
            logger.info(`${this.TAG}: ${msg}`);
        }
    }

    setCompressStream(isCompressInput, isCompressOutput) {
        //this.log(`setCompressStream. isCompressInput: ${isCompressInput},  isCompressOutput: ${isCompressOutput}`)
        if (isCompressInput) {
            this.compressedStream = new CompressedStream(this.socket);
            this.compressedStream.compressedInput = true;
            this.compressedInput = true;
        }
        if (isCompressOutput) {
            this.compressedOutput = true;
        }
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
            //debug = true;
        }
        if (this.DEBUG) this.log(`readChunk. size: ${size}`);
        let stream;
        if (this.compressedInput && this.compressedStream) {
            stream = this.compressedStream;
        } else {
            stream = this.socket;
        }
        return new Promise((resolve, reject) => {
            if (nc._err) {
                reject(nc._err);
                return;
            }
            let isResolved = false;
            const readableHandler = () => {
                if (this.DEBUG) this.log(`readChunk. readableHandler`);
                //if (this.__proto__.constructor.name == "PlayerConn") this.log(`readChunk. readableHandler`);
                try {
                    let chunk = stream.read(size);
                    //if (this.__proto__.constructor.name == "PlayerConn") this.log(`readChunk. readableHandler. chunk: ${chunk}`);
                    if (chunk) {
                        if (this.DEBUG) this.log(`readChunk. resolve: ${size}`);
                        removeListeners();
                        if (!isResolved) {
                            isResolved = true;
                            if (this.bwStats || this.countBWStats) {
                                this.addInBytes(size);
                            }
                            resolve(chunk);
                        }
                        return;
                    }
                } catch (err) {
                    //this.log(`readChunk error: ${err}`);
                    removeListeners();
                    if (!isResolved) {
                        isResolved = true;
                        reject(err);
                    }
                }
            };
            const closeHandler = () => {
                if (debug) this.log("readChunk closeHandler");
                removeListeners();
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error("Connection closed"));
                }
            };

            const endHandler = () => {
                if (debug) this.log("readChunk endHandler");
                removeListeners();
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error("Connection ended"));
                }
            };

            const errorHandler = (err) => {
                if (debug) this.log("readChunk errorHandler: " + err);
                removeListeners()
                if (!isResolved) {
                    isResolved = true;
                    reject(err)
                }
            };
            const removeListeners = () => {
                stream.removeListener("close", closeHandler);
                stream.removeListener("error", errorHandler);
                stream.removeListener("end", endHandler);
                stream.removeListener("readable", readableHandler);
            }
            stream.on("close", closeHandler)
            stream.on("end", endHandler)
            stream.on("error", errorHandler)
            stream.on('readable', readableHandler);
        });
    }

    async compressAndSend() {
        if (!this.compressedOutput || !this.compressArr || this.compressBuffPos == 0) {
            return;
        }
        const sendBuff = Buffer.from(this.compressArr.buffer, 0, this.compressBuffPos);

        ///*if (this.DEBUG) {
        //this.log(`compressAndSend: this.compressBuffPos: ${this.compressBuffPos}, sendBuff : ${sendBuff.length}`);
        //}*/
        await this.writeChunkImp(sendBuff, false);
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
                return await this.writeChunkImp(chunk, true);
            } else {
                // write compress data
                if (this.compressBuffPos + chunk.length > COMPRESSION_BUFFER_SIZE) {
                    await this.compressAndSend();
                }
                if (chunk.length <= COMPRESSION_BUFFER_SIZE) {
                    chunk.copy(this.compressBuff, this.compressBuffPos);
                    this.compressBuffPos += chunk.length;
                    //this.log(`Add write data of size: ${chunk.length}. total buffer: ${this.compressBuffPos}`);
                } else {
                    //this.log(`large buffer for compression. divide it`);
                    let cnt = 0;

                    while (cnt < chunk.length) {
                        const remains = (chunk.length - cnt);
                        let len = (remains > COMPRESSION_BUFFER_SIZE ? COMPRESSION_BUFFER_SIZE : remains);
                        //chunk.copy(this.compressBuff, 0, cnt, len);
                        this.copyBuff(chunk, this.compressBuff, cnt, 0, len);
                        this.compressBuffPos = len;
                        //this.log(`Sending ${len} bytes from offset ${cnt}`);
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

    /**
     *
     * @param {Buffer} srcBuff
     * @param {Buffer} targetBuff
     * @param {*} offsetSrc
     * @param {*} offsetTarget
     * @param {*} length
     */
    copyBuff(srcBuff, targetBuff, offsetSrc, offsetTarget, length) {
        if (!length) {
            length = srcBuff.length - offsetSrc;
        }
        for (let i = 0; i < length; i++) {
            const b = srcBuff.readUInt8(i + offsetSrc);
            targetBuff.writeUInt8(b, i + offsetTarget);
        }
    }

    writeChunkImp(chunk, doNotCompressChunk) {
        const nc = this;
        return new Promise((resolve, reject) => {
            if (nc._err) {
                reject(nc._err);
                return;
            }

            let haveListeners = true;

            const writeHandler = () => {
                //logger.info(`${this.TAG}. writeHandler...`);
                if (haveListeners) {
                    removeListeners();
                    resolve();
                }
            };

            const closeHandler = () => {
                if (haveListeners) {
                    removeListeners()
                    reject(new Error("writeChunkImp: Connection closed"))
                }
            };

            const endHandler = () => {
                if (haveListeners) {
                    removeListeners()
                    reject(new Error("writeChunkImp: Connection ended"))
                }
            };

            const errorHandler = (err) => {
                if (haveListeners) {
                    removeListeners()
                    reject(err)
                }
            };

            const removeListeners = () => {
                haveListeners = false;
                nc.socket.removeListener("close", closeHandler);
                nc.socket.removeListener("error", errorHandler);
                nc.socket.removeListener("end", endHandler);
            }
            nc.socket.on("close", closeHandler);
            nc.socket.on("end", endHandler);
            nc.socket.on("error", errorHandler);
            if (!this.compressedOutput) {
                try {
                    nc.socket.write(chunk, writeHandler);
                    if (this.bwStats || this.countBWStats) {
                        this.addOutBytes(chunk.length);
                    }
                } catch (err) {
                    nc.log(`write error: ${err}`);
                    errorHandler(err);
                }
            } else {
                if (doNotCompressChunk) {
                    const buf = Buffer.alloc(5);
                    buf.writeUInt8(0);
                    buf.writeUInt32BE(chunk.length, 1);
                    try {
                        nc.socket.write(buf);
                        nc.socket.write(chunk, writeHandler);
                        if (this.bwStats || this.countBWStats) {
                            this.addOutBytes(chunk.length + 5);
                        }
                    } catch (err) {
                        nc.log(`write error: ${err}`);
                        errorHandler(err);
                    }
                    //logger.info(`write compress stream di: 0, len: ${chunk.length}, chunk: ${(chunk.length < 50 ? chunk.toString('hex') : "")}`);
                } else {
                    zlib.deflate(chunk, (err, deflatted) => {
                        if (err) {
                            nc.log(`deflate error: ${err}`);
                            errorHandler(err);
                        } else {
                            const buf = Buffer.alloc(5);
                            buf.writeUInt8(1);
                            buf.writeUInt32BE(deflatted.length, 1);
                            try {
                                nc.socket.write(buf);
                                nc.socket.write(deflatted, writeHandler);
                                if (this.bwStats || this.countBWStats) {
                                    this.addOutBytes(deflatted.length + 5);
                                }
                            } catch (err) {
                                nc.log(`write error: ${err}`);
                                errorHandler(err);
                            }
                            //logger.info(`write compress stream di: 1, len: ${deflatted.length}, source len: ${chunk.length}`);
                        }
                    });
                }
            }

        });
    }

    addOutBytes(bytes) {
        if (this.bwStats) {
            this.bwStats.addOutBytes(bytes);
        } else {
            if (!this.outBytes) {
                this.outBytes = 0;
            }
            this.outBytes += bytes;
        }
    }

    addInBytes(bytes) {
        if (this.bwStats) {
            this.bwStats.addInBytes(bytes);
        } else {
            if (!this.inBytes) {
                this.inBytes = 0;
            }
            this.inBytes += bytes;
        }
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
