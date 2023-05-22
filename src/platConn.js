"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
// const { NetConn} = require('node-tcp');
const { NetConn} = require('node-tcp');

const jwt = require('jsonwebtoken');
const mgmtCall = require('./mgmtCall');
const PlayerConn = require('./playerConn');
const {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
    ChannelType,
} = require('./constants');

const CMD_HEADER_SIZE = 13;

class PlatConn extends NetConn {
    /**
     *
     * @param {net.Socket} socket
     */
    constructor(socket) {
        super(socket);

        this.runPlatConnn();
    }

    info(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    async runPlatConnn() {
        this.mStopThread = false;
        this.socket.setTimeout(60000 * 60 * 24); // default socket timeout is one day for platforms
        try {
            this.mPlatformId = await this.readInt();
            this.mSessionId = await this.readStringOld();
            this.mProcessId = await this.readInt();
            this.mChannelType = await this.readInt();
            this.mChannelIdx = await this.readInt();
            this.info("Adding platform connection. mProcessId: " + this.mProcessId + ", mSessionId: " + this.mSessionId + ", mChannelType: " + this.mChannelType + ", mChannelIdx: " + this.mChannelIdx);
            await this.addPlatformConnection();
            while (!this.mStopThread) {
                await this.drawCmdPlatform2Client();
            }

        } catch (err) {
            if(err.message === "Connection ended") {
                logger.error(`${this.TAG}: Connection ended`);
            } else {
                logger.error(`${this.TAG}: Error`, err);
            }
        }

        if (this.mChannelType == ChannelType.main) {
            // send remove process to client only if this is the main channel to the process
            this.sendRemoveProcess2Client();
        }

        this.removePlatformConnection();


        if (!this.socket.destroyed) {
            try {
                this.socket.destroy();
            } catch (err) {

            }
        }
        logger.info(`${this.TAG}: finished.`);
    }

    async addPlatformConnection() {
        const { getSession } = require('./session');
        const session = getSession(this.mSessionId);
        if (!session.validSession) {
            let valid = await session.validateSession(2);
            //this.log(`validateSession result: ${valid}. mPlatformController: ${session.mPlatformController}`);
        } else {
            let changed = await session.associatePlatConnToPlatformController(this);
            if (changed) {
                // if value changed - we will re-validate  session
                this.info(`addPlatformConnection. platform controller changed. re-validate session`);
                await session.validateSession(2);
            }
        }
        if (!session || !session.validSession) {
            this.info(`addPlatformConnection. Faild to validate session. Aborting connection. mSessionId: ${this.mSessionId}`);
            this.mStopThread = true;
            return;
        }
        this.mSession = session;
        if (session.mPlatformController == null) {
            this.info("addPlatformConnection. cannot find platformController." + ", userId=" + this.mSessionId +
                ", platformId=" + this.mPlatformId);
            this.mStopThread = true;
            return;
        }
        session.mPlatformController.addPlatformConnection(this);
        session.addPlatformConnection(this);


        let pc = this;
        this.writeQ.push(async() => {
            //pc.log(`Write ack to platfrom. mSessionId: ${this.mSessionId}`);
            try {
                await this.writeInt(PlayerCmd.platformProcessConnected);
                await this.writeStringOld(this.mSessionId);
            } catch(err) {
                this.info(`addPlatformConnection. writeQ error: ${err}`);
            }
        });



    }

    sendRemoveProcess2Client() {
        this.sendCmd(CMD_HEADER_SIZE, this.mProcessId, DrawCmd.removeProcess, 0, false);

    }

    removePlatformConnection() {
        if (this.mSession) {
            this.mSession.removePlatformConnection(this);
            if (this.mSession.mPlatformController) {
                this.mSession.mPlatformController.removePlatformConnection(this);
            }
        }
    }

    /**
     * @returns {string}
     */
    getHash() {
        //processID,channelType,channelIdx
        return `${this.mProcessId}:${this.mChannelType}:${this.mChannelIdx}`;
    }



    async drawCmdPlatform2Client() {
        const bytesCount = await this.readInt();
        const processId = await this.readInt();
        const cmdcode = await this.readByte();
        const wndId = await this.readInt();
        if (this.mProcessId != processId) {
            throw new Error(`drawCmdPlatform2Client. Invalid process ID: ${processId} `);
        }
        let data = null;
        if (bytesCount > CMD_HEADER_SIZE) {
            data = await this.readBuffer(bytesCount - CMD_HEADER_SIZE);
        }
        await this.sendCmd(bytesCount, processId, cmdcode, wndId, true, data);
    }

    async sendCmd(bytesCount, processId, cmdcode, wndId, isPlatformCmd, data) {
        let wroteData = false;
        let playerConn = null;
        if (this.mSession) {
            let isFlush = (cmdcode > DrawCmd.IMMEDIATE_COMMAND || cmdcode == DrawCmd.drawPlayerLoginAck || cmdcode < 0 || cmdcode == DrawCmd.openGLVideoPacket);
            wroteData = await this.mSession.writeToClient(bytesCount,processId,cmdcode,wndId,data,isFlush, this.mChannelType, this.mChannelIdx);
            /*playerConn = this.mSession.mPlayerConnection;
            if (playerConn) {
                let isFlush = (cmdcode > DrawCmd.IMMEDIATE_COMMAND || cmdcode == DrawCmd.drawPlayerLoginAck || cmdcode < 0 || cmdcode == DrawCmd.openGLVideoPacket);
                playerConn.writeToClient(bytesCount, processId, cmdcode, wndId, data, isFlush);
                wroteData = true;
            } else {

            }*/
        }
        if (!wroteData) {
            this.info(`Cannot write data as player connection is not available. this.mSession: ${this.mSessionId}, cmdcode: ${( cmdcode)}`);
        }
    }

    sendInitProcessFPS(netQ) {
        if (this.mSession) {
            //this.log("sendInitProcessFPS..");
            this.writeQ.push(async() => {
                try {
                    await this.writeInt(PlayerCmd.initProcessFPS);
                    await this.writeStringOld(this.mSessionId);
                    await this.writeInt(PlayerCmd.netQ);
                } catch(err) {
                    this.info(`sendInitProcessFPS. writeQ error: ${err}`);
                }
            });
        } else {
            this.info("sendInitProcessFPS.. this.mSession is null!!");
        }
    }

    sendSync() {
        if (this.mSession) {
            //this.log("sendSync..");
            this.writeQ.push(async() => {
                try {
                    await this.writeInt(PlayerCmd.sync);
                    await this.writeStringOld(this.mSessionId);
                } catch(err) {
                    this.info(`sendSync. writeQ error: ${err}`);
                }
            });
        }
    }

    killUserApps() {
        if (this.mSession) {
            //this.log("killUserApps..");
            this.writeQ.push(async() => {
                try {
                    await this.writeInt(PlayerCmd.killUserApps);
                    await this.writeStringOld(this.mSessionId);
                } catch(err) {
                    this.info(`killUserApps. writeQ error: ${err}`);
                }
            });
        }
    }

    async closePlatConn() {
        this.mStopThread = true;
        try {
            this.socket.destroy();
        } catch (err) {

        }
    }


}

module.exports = PlatConn;
