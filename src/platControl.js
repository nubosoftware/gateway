"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const NetConn = require('./netConn');
const jwt = require('jsonwebtoken');
const mgmtCall = require('./mgmtCall');
const PlatConn = require('./platConn');
const {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
} = require('./constants');

let platformControllers = [];

class PlatControl extends NetConn {
    /**
     *
     * @param {net.Socket} socket
     */
    constructor(socket) {
        super(socket);

        this.mPlatformConnections = [];
        this.runPlatControl();
    }

    static waitForPlatformControl(platformID) {
        return new Promise((resolve, reject) => {
            let tries = 0;
            let getPlatformControl = function() {
                const pc = platformControllers[platformID];
                if (pc) {
                    resolve(pc);
                } else if (tries < 10) {
                    tries++;
                    setTimeout(getPlatformControl, 1000);
                } else {
                    reject(new Error(`Cannot find platform controller ${platformID}`));
                }
            }
            getPlatformControl();
        });
    }



    async runPlatControl() {
        this.mStopThread = false;
        try {
            await this.setPlatformId();
            while (!this.mStopThread) {
                await this.handlePlatform2PlayerControlCmds();
            }
        } catch (err) {
            logger.error(`${this.TAG}: Error`, err);
        }

        if (this.mPlatformId) {
            let pc = platformControllers[this.mPlatformId];
            if (pc == this) {
                delete platformControllers[this.mPlatformId];
            }
        }
        if (!this.socket.destroyed) {
            try {
                this.socket.destroy();
            } catch (err) {

            }
        }
        logger.info(`${this.TAG}: finished.`);
    }

    async setPlatformId() {
        let cmd = await this.readInt();
        this.log("setPlatformId. cmd: " + cmd);
        if (cmd == PlatformCtrlCmd.newPlatform) {
            this.mPlatformId = await this.readInt();
        } else {
            throw new Error(`Invalid setPlatformId command: ${cmd}`);
        }

        let pc = platformControllers[this.mPlatformId];
        if (pc != null && pc != this) {
            this.log("Found old platform controller with the same if (${this.mPlatformId}), close old controller.");
            await pc.closePlatControl();
        }

        platformControllers[this.mPlatformId] = this;
        this.log("setPlatformId. mPlatformId: " + this.mPlatformId);
    }


    async handlePlatform2PlayerControlCmds() {
        //this.log(`handlePlatform2PlayerControlCmds`);
        let cmd = await this.readInt();
        switch (cmd) {
            case PlatformCtrlCmd.roundTripData:
                {
                    let millis = await this.readLong();
                    this.writeQ.push(async() => {
                        try {
                            await this.writeInt(PlatformCtrlCmdSize.roundTripDataAck);
                            await this.writeInt(PlatformCtrlCmd.roundTripDataAck);
                            await this.writeLong(millis);
                        } catch(err) {
                            this.log(`roundTripData. writeQ error: ${err}`);
                        }
                    });
                    //await this.flush();
                }
                break;
            case PlatformCtrlCmd.audioParams:
                {
                    const userId = await this.readInt();
                    const playbackStarted = await this.readBoolean();
                    const playbackStreamType = await this.readInt();
                    const recordStarted = await this.readBoolean();
                    const recordInputSource = await this.readInt();
                    const speakerPhoneOn = await this.readBoolean();

                    const platformUserKey = ((this.mPlatformId & 0xFFFF) << 16) | (userId & 0xFFFF);
                    const PlayerConn = require('./playerConn');
                    const playerConn = PlayerConn.getPlayerConnByPlatUser(platformUserKey);

                    if (playerConn != null) {
                        this.log("Sending audio params to player");
                        playerConn.sendAudioParams(playbackStarted, playbackStreamType, recordStarted, recordInputSource, speakerPhoneOn);
                    } else {
                        this.log("Cannot send audio params to player. Player connection not found for userId: " + userId);
                    }
                }
                break;
            default:
                throw new Error(`Unknown platform controler command: ${cmd}`);

        }
    }

    async closePlatControl() {
        this.mStopThread = true;
        try {
            this.socket.destroy();
        } catch (err) {

        }
    }




    /**
     *
     * @param {PlatConn} platConn
     */
    addPlatformConnection(platConn) {
        this.mPlatformConnections[platConn.getHash()] = platConn;
    }

    /**
     *
     * @param {PlatConn} platConn
     */
    removePlatformConnection(platConn) {
        if (this.mPlatformConnections[platConn.getHash()] == platConn) {
            delete this.mPlatformConnections[platConn.getHash()];
        }
    }
}

module.exports = PlatControl;