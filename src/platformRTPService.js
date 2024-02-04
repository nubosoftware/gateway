"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const { RTPPacket, RTP_HEADER_LENGTH } = require('./rtpPacket');
const EventEmitter = require('events');
const dgram = require('dgram');
const PlayerConn = require('./playerConn');

let instance = null;

class PlatformRTPService extends EventEmitter {
    /**
     *
     * @param {number} port
     */
    constructor(port) {
        super();
        this.TAG = `PlatformRTPService_${port}`;
        const server = dgram.createSocket('udp4');
        this.server = server;

        server.on('error', (err) => {
            this.log(`server error:\n${err.stack}`);
            server.close();
            //this.emit('error', err);
        });

        server.on('message', (msg, rinfo) => {
            //this.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
            this.onPacket(msg, rinfo);
        });

        server.on('listening', () => {
            const address = server.address();
            this.log(`server listening ${address.address}:${address.port}`);
            this.emit('listening');
        });

        server.bind(port);

        instance = this;
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    /**
     * @returns {PlatformRTPService}
     */
    static getInstance() {
        return instance;
    }

    /**
     *
     * @param {Buffer} buff
     * @param {String} address
     * @param {number} port
     */
    sendPacket(buff, address, port) {
        try {
            this.server.send(buff, port, address, (err) => {
                if (err) {
                    this.log(`Error sending packet: ${err}`);
                }
            });
        } catch (err) {
            this.log(`Error sending packet: ${err}`);
        }
    }

    /**
     *
     * @param {Buffer} packet
     * @param {*} rinfo
     */
    onPacket(buf, rinfo) {
        if (buf.length >= RTP_HEADER_LENGTH) {
            try {
                const rtpPacket = new RTPPacket(buf);
                //this.log(`recieved RTP packet. sequenceNumber: ${rtpPacket.sequenceNumber}, payloadType: ${rtpPacket.payloadType}, ssrc: ${rtpPacket.ssrc}, payload length: ${rtpPacket.payload.length}`);

                const pc = PlayerConn.getPlayerConnByPlatUser(rtpPacket.ssrc);
                if (pc) {
                    pc.sendMediaPacket(rtpPacket, rinfo);
                } else {
                    this.log(`Cannot find player connection with platformUserKey: ${rtpPacket.ssrc}`);
                }
            } catch (err) {
                this.log(`Error parsing RTP packet: ${err}`);
            }
        }
    }
}

module.exports = { PlatformRTPService };