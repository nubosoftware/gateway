"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
var RTP_HEADER_LENGTH = 12;
class RTPPacket {


    /**
     * 
     * @param {Buffer|number} arg1 
     * @param {number} Framenb 
     * @param {number} Time 
     * @param {number} ssrc
     * @param {Buffer} data 
     */
    constructor(arg1, Framenb, Time, ssrc, data) {
        if (!Buffer.isBuffer(arg1)) {
            const PType = arg1;
            //fill by default header fields:
            this.version = 2;
            this.padding = 0;
            this.extension = 0;
            this.csrcCount = 0;
            this.marker = 0;
            this.ssrc = ssrc; // Identifies the server

            //fill changing header fields:
            this.sequenceNumber = Framenb;
            this.timestamp = Time;
            this.payloadType = PType;


            // alocate memory for the entire rtp packet
            this.srcBuffer = Buffer.allocUnsafe(RTP_HEADER_LENGTH + data.length);

            // write the header
            this.srcBuffer.writeUInt8(this.version << 6 | this.padding << 5 | this.extension << 4 | this.csrcCount);
            this.srcBuffer.writeUInt8(this.marker << 7 | this.payloadType & 0x000000FF, 1);
            this.srcBuffer.writeUInt16BE(this.sequenceNumber, 2)
            this.srcBuffer.writeUInt32BE(this.timestamp, 4);
            this.srcBuffer.writeUInt32BE(this.ssrc, 8);

            for (let i = 0; i < data.length; i++) {
                const b = data.readUInt8(i);
                this.srcBuffer.writeUInt8(b, i + RTP_HEADER_LENGTH);
            }


            // copy the data into the payload buffer
            //data.copy(this.srcBuffer, RTP_HEADER_LENGTH, 0, data.length);

            // mark the payload buffer inside the packet buffer
            this.payload = Buffer.from(this.srcBuffer.buffer, RTP_HEADER_LENGTH);





            //logger.info("data Buffer: " + data.toString('hex'));
            //logger.info("RTP Buffer: " + this.srcBuffer.toString('hex'));



        } else {
            const buf = arg1;
            if (buf.length < RTP_HEADER_LENGTH) {
                throw new Error('can not parse buffer smaller than fixed header');
            }

            this.srcBuffer = buf;
            const firstByte = buf.readUInt8(0);
            const secondByte = buf.readUInt8(1);
            this.version = firstByte >> 6;
            this.padding = (firstByte >> 5) & 1;
            this.extension = (firstByte >> 4) & 1;
            this.csrcCount = firstByte & 0x0f;
            this.marker = secondByte >> 7;
            this.payloadType = secondByte & 0x7f;
            this.sequenceNumber = buf.readUInt16BE(2);
            this.timestamp = buf.readUInt32BE(4);
            this.ssrc = buf.readUInt32BE(8);
            this.csrc = [];
            for (var i = 0; i < this.csrcCount; i++) {
                this.csrc.push(buf.readUInt32BE(9 + 4 * i));
            }
            this.payload = buf.slice(RTP_HEADER_LENGTH + 4 * this.csrcCount);
            //logger.info("payload Buffer: " + this.payload.toString('hex'));
            //logger.info("RTP Buffer: " + this.srcBuffer.toString('hex'));
        }
    }
}

module.exports = { RTPPacket, RTP_HEADER_LENGTH };