"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const { RTPPacket, RTP_HEADER_LENGTH } = require('./rtpPacket');
const EventEmitter = require('events');
const dgram = require('dgram');
const PlayerConn = require('./playerConn');

const PAYLOAD_AUDIO_DOWNSTREAM = 1;
const PAYLOAD_AUDIO_UPSTREAM = 2;
const PAYLOAD_AUDIO_KEEP_ALIVE = 3;

class PlayerRTPSocket extends EventEmitter {
    /**
     * 
     * @param {number} port 
     */
    constructor(port) {
        super();
        this.TAG = `PlayerRTPSocket_${port}`;
        const server = dgram.createSocket('udp4');
        this.server = server;

        server.on('error', (err) => {
            this.log(`server error:\n${err.stack}`);
            server.close();
            this.emit('error', err);
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
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }


    /**
     * 
     * @param {string} rtpAudioDownInetAddress 
     * @param {number} rtpAudioDownPort 
     * @param {RTPPacket} rtpPacket 
     */
    sendDataToPlayer(rtpAudioDownInetAddress, rtpAudioDownPort, rtpPacket) {
        try {
            //this.log(`send RTP packet to address: ${rtpAudioDownInetAddress}:${rtpAudioDownPort} sequenceNumber: ${rtpPacket.sequenceNumber}, payloadType: ${rtpPacket.payloadType}, ssrc: ${rtpPacket.ssrc}, payload length: ${rtpPacket.payload.length}`);
            this.server.send(rtpPacket.srcBuffer, rtpAudioDownPort, rtpAudioDownInetAddress);
        } catch (err) {
            this.log(`Error sendDataToPlayer: ${err}`);
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

                if (rtpPacket.payloadType == PAYLOAD_AUDIO_DOWNSTREAM || rtpPacket.payloadType == PAYLOAD_AUDIO_UPSTREAM) {
                    const str = "host: " + rinfo.address + ", port: " + rinfo.port + ", " + ((rtpPacket.payloadType == PAYLOAD_AUDIO_DOWNSTREAM) ? "playback" : "recorder");
                    this.log(str);
                    const packetContent = rtpPacket.payload.toString();
                    this.log(`packetContent: ${packetContent}`);
                    // check if audio is autheticated in the new way
                    if (packetContent.startsWith("RTPAuth:")) {
                        const authFields = packetContent.split(":");
                        if (authFields.length == 3) {
                            const audioToken = authFields[1];
                            const jwtToken = authFields[2];
                            const pc = PlayerConn.getPlayerConnectionByToken(audioToken);
                            if (pc) {
                                this.log("Found player connection for audioToken " + audioToken);
                                if (pc.validateJwtToken(jwtToken)) {
                                    this.log("Validated player connection!");
                                    if (rtpPacket.payloadType == PAYLOAD_AUDIO_DOWNSTREAM) {
                                        pc.rtpAudioDownInetAddress = rinfo.address;
                                        pc.rtpAudioDownPort = rinfo.port;
                                        pc.rtpSocket = this;
                                    } else {
                                        pc.setRTPUploadAddr(rinfo.address, rinfo.port);
                                    }
                                    const utf8Bytes = Buffer.from(str);
                                    this.server.send(utf8Bytes, rinfo.port, rinfo.address);
                                } else {
                                    this.log("JWT Token is not valid for player connection: " + jwtToken);
                                }
                            } else {
                                this.log("Invalid audioToken: " + audioToken);
                            }

                        } else {
                            this.log("Invalid RTPAuth packet: " + packetContent);
                        }
                    } else {
                        // the old no-standatd way
                        // first try to extract token and find the player connection
                        /*String token = RTPAuth.normalizeBase64Str(packetContent);
                        PlayerConnection pc = mGateway.getPlayerConnctionByToken(token);
                        if (pc != null) {
                            Log.v(TAG, "Found player connection for token " + token);
                            if (parsedPacket.PayloadType == PAYLOAD_AUDIO_DOWNSTREAM) {
                                pc.rtpAudioDownInetAddress = sa.getAddress();
                                pc.rtpAudioDownPort = sa.getPort();
                            } else {
                                pc.setRTPUploadAddr(sa);
                            }
                            byte[] utf8Bytes = str.getBytes("UTF8");
                            DatagramPacket sendPacket = new DatagramPacket(utf8Bytes, utf8Bytes.length,
                                sa.getAddress(), sa.getPort());
                            socket.send(sendPacket);
                        } else {
                            Log.e(TAG + " Invalid token: " + token);
                        }*/
                    }
                } else if (rtpPacket.payloadType == PAYLOAD_AUDIO_KEEP_ALIVE) {
                    this.log("RTP Keep alive from: " + rinfo.address + ":" + rinfo.port);
                    this.server.send(rtpPacket.srcBuffer, rinfo.port, rinfo.address);
                } else {
                    //Log.e(TAG+" RTP Data. pt: "+parsedPacket.PayloadType+", size: "+parsedPacket.payload_size);
                    const pc = PlayerConn.getPlayerConnctionByRTPUploadAddr(rinfo.address, rinfo.port);
                    if (pc) {
                        if (pc.rtpAudioUpInetAddress != null && pc.rtpAudioUpPort > 0) {
                            //Log.e(TAG+" Sending packet to "+pc.rtpAudioUpInetAddress+", port: "+pc.rtpAudioUpPort);
                            //this.sendData(pc.rtpAudioUpInetAddress, pc.rtpAudioUpPort, rtpPacket);
                            this.server.send(rtpPacket.srcBuffer, pc.rtpAudioUpPort, pc.rtpAudioUpInetAddress);
                        }
                    } else {
                        this.log(`Not found player connection with address: ${rinfo.address}:${rinfo.port}`);
                    }
                }
            } catch (err) {
                this.log(`Error parsing RTP packet: ${err}`);
            }
        }
    }
}

module.exports = { PlayerRTPSocket };
//