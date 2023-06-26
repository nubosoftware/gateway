"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
// const { NetConn} = require('node-tcp');
const { NetConn } = require('node-tcp');
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

    info(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    static waitForPlatformControl(platformKey) {
        return new Promise((resolve, reject) => {
            let tries = 0;
            let getPlatformControl = function() {
                const pc = platformControllers[platformKey];
                if (pc) {
                    resolve(pc);
                } else if (tries < 10) {
                    tries++;
                    setTimeout(getPlatformControl, 1000);
                } else {
                    reject(new Error(`Cannot find platform controller ${platformKey}`));
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

        // remove platform controller from the conroller map
        if (this.mPlatformKey) {
            let pc = platformControllers[this.mPlatformKey];
            if (pc == this) {
                delete platformControllers[this.mPlatformKey];
            }
        }
        if (this.mSessionId) {
            logger.error(`${this.TAG}: Closing platform control for session ${this.mSessionId}`);
            const { getSession } = require('./session');
            const session = getSession(this.mSessionId);
            if (session) {
                session.removePlatformController(this);
            }
        }
        if (!this.socket.destroyed) {
            try {
                this.socket.destroy();
            } catch (err) {

            }
        }
        this.info(`finished.`);
    }

    async setPlatformId() {
        let cmd = await this.readInt();
        let dockerPlatform = Common.settings.dockerPlatform;
        this.info(`setPlatformId. cmd: ${cmd}, dockerPlatform: ${dockerPlatform}`);

        if (cmd == PlatformCtrlCmd.newPlatform && !dockerPlatform) {
            this.mPlatformId = await this.readInt();
            this.mPlatformKey = this.mPlatformId;
        } else if (cmd == PlatformCtrlCmd.newPlatformDocker && dockerPlatform) {
            this.mPlatformId = await this.readInt();
            this.mUserId = await this.readInt();
            this.mSessionId = await this.readStringOld();
            this.mPlatformKey = this.mSessionId;
        } else {
            throw new Error(`Invalid setPlatformId command: ${cmd}`);
        }


        let pc = platformControllers[this.mPlatformKey];
        if (pc != null && pc != this) {
            this.info(`Found old platform controller with the same key (${this.mPlatformKey}), close old controller.`);
            await pc.closePlatControl();
        }

        platformControllers[this.mPlatformKey] = this;
        this.info("setPlatformId. mPlatformKey: " + this.mPlatformKey);
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
                            this.info(`roundTripData. writeQ error: ${err}`);
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
                        this.info("Sending audio params to player");
                        playerConn.sendAudioParams(playbackStarted, playbackStreamType, recordStarted, recordInputSource, speakerPhoneOn);
                    } else {
                        this.info("Cannot send audio params to player. Player connection not found for userId: " + userId);
                    }
                }
                break;
            case PlatformCtrlCmd.biometricCommand:
                {
                    const size = await this.readInt();
                    this.info("biometricCommand. size: "+size);
                    const chunk = await this.readBuffer(size);
                    const { getSession } = require('./session');
                    const session = getSession(this.mSessionId);
                    const playerConn = session.mPlayerConnection;
                    if (playerConn != null) {
                        this.info("Sending biometric command to player");
                        playerConn.sendCmdWithBuffer(-1,PlatformCtrlCmd.biometricCommand,-1,chunk);
                    } else {
                        this.info("Cannot biometric command to player. Player connection not found for mSessionId: " + this.mSessionId);
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