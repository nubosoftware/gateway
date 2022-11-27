"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const mgmtCall = require('./mgmtCall');
const PlayerConn = require('./playerConn');
const PlatControl = require('./platControl');
const PlatConn = require('./platConn');
const EventEmitter = require('events');
const sessions = {};


const errIllegalRedisData = -3;
const errIllegalSessionID = -2;
const errNoConnection_GW_REDIS = -1;
const OK = 0;

class Session extends EventEmitter {
    /**
     *
     * @param {String} sessionID
     */
    constructor(sessionID) {
        super();
        this.sessionID = sessionID;
        this.TAG = `session_${sessionID}`;
        this.mPlayerChannels = {};
        this.mPlatConnections = {};
        sessions[sessionID] = this;
        this.mValidateStartTime = null;
        this.clientQ = [];
        this.validSession = false;
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async validateSession(suspend, doNotRefreshData) {
        //this.log(`validateSession. session: ${this.sessionID}, suspend: ${suspend}, doNotRefreshData: ${doNotRefreshData}`);
        // check if we can limit execution of mutiple requests
        if (suspend == 2 && !doNotRefreshData) {
            let startTime = new Date().getTime();
            if (this.mValidateStartTime &&  (startTime - this.mValidateStartTime) < 2000) {
                // validation is already running - wait for it
                //this.log(`validateSession. Wait for mutiple execution for session: ${this.sessionID}`);
                let cnt = 0;
                while(cnt < 20) {
                    await this.sleep(100);
                    cnt++;
                    if (!this.mValidateStartTime) {
                        this.log(`validateSession. Finish waiting for session ${this.sessionID}, validSession: ${this.validSession}`);
                        return this.validSession;
                    }
                }

            }
            this.mValidateStartTime = startTime;
        }
        let response;
        try {
            response = await mgmtCall.get({
                url: "/redisGateway/validateUpdSession?session=" + this.sessionID + "&suspend=" + suspend,
            });
        } catch(err) {
            this.log(`validateSession. redisGateway error: ${err}`);
            this.validSession = false;
            this.mValidateStartTime = null;
            return false;
        }
        if (doNotRefreshData && suspend != 0) {
            // we use this only to change suspend values
            return false;
        }
        if (suspend == 2) {
            this.mValidateStartTime = null;
        }
        //this.log("validateSession. response: " + JSON.stringify(response.data, null, 2));
        if (response.data.status == OK) {
            this.validSession = true;
            this.sessionParams = response.data.session;
            //this.log("Session found. Params: " + JSON.stringify(this.sessionParams, null, 2));
            if (suspend == 0 && this.sessionParams.recording_name) {
                this.mRecordingName = this.sessionParams.recording_name;
                this.log(`Recording name: ${this.mRecordingName}`);
            }
            if (!doNotRefreshData) {
                this.mUserId = this.sessionParams.localid;
                this.mPlatformId = this.sessionParams.platid;
                this.mPlatformKey = (Common.settings.dockerPlatform ? this.sessionID : this.mPlatformId);
                this.email = this.sessionParams.email;
                this.mPlatformController = await PlatControl.waitForPlatformControl(this.mPlatformKey);
            }
            this.validSession = true;
        } else {
            this.log("validateSession. response: " + JSON.stringify(response.data, null, 2));
            this.validSession = false;
        }
        return this.validSession;
    }



    /**
     *
     * @param {PlayerConn} playerConnection
     */
    addPlayerConnection(playerConnection) {
        if (playerConnection.mChannelType == 0) {
            this.mPlayerConnection = playerConnection;
        } else {
            const hash = this.getConnectionHash(playerConnection.mChannelProcess, playerConnection.mChannelType, playerConnection.mChannelIdx);
            this.mPlayerChannels[hash] = playerConnection;
            if (playerConnection.mChannelType == 4) { // audio channel
                this.mAudioChannelPlayerConnection = playerConnection;
            } else if (playerConnection.mChannelType == 2 && playerConnection.mChannelIdx == 0) { // opengl channel
                this.mOpenGLChannelPlayerConnection = playerConnection;
            }
        }
    }

    /**
     *
     * @param {PlayerConn} playerConnection
     */
    removePlayerConnection(playerConnection) {
        //this.log(`removePlayerConnection: mChannelType: ${playerConnection.mChannelType}`);
        if (playerConnection.mChannelType == 0) {
            if (this.mPlayerConnection == playerConnection) {
                this.mPlayerConnection = null;
            }
        } else {
            const hash = this.getConnectionHash(playerConnection.mChannelProcess, playerConnection.mChannelType, playerConnection.mChannelIdx);
            if (this.mPlayerChannels[hash] == playerConnection) {
                delete this.mPlayerChannels[hash];
            }
            if (playerConnection.mChannelType == 4 && this.mAudioChannelPlayerConnection == playerConnection) { // audio channel
                this.mAudioChannelPlayerConnection = null;
            } else if (playerConnection.mChannelType == 2 && playerConnection.mChannelIdx == 0 && this.mOpenGLChannelPlayerConnection == playerConnection) { // opengl channel
                this.mOpenGLChannelPlayerConnection = null;
            }
        }
        this.checkRemoveSession();
    }

    getConnectionHash(processID, channelType, channelIdx) {
        return `${processID}_${channelType}_${channelIdx}`;
    }

    /**
     *
     * @param {PlatConn} platConn
     */
    addPlatformConnection(platConn) {
        const hash = this.getConnectionHash(platConn.mProcessId, platConn.mChannelType, platConn.mChannelIdx);
        this.mPlatConnections[hash] = platConn;
        //this.log(`addPlatformConnection: ${hash}. len: ${Object.keys(this.mPlatConnections).length}`);
    }

    /**
     *
     * @param {PlatConn} platConn
     */
    removePlatformConnection(platConn) {
        const hash = this.getConnectionHash(platConn.mProcessId, platConn.mChannelType, platConn.mChannelIdx);
        if (this.mPlatConnections[hash] == platConn) {
            //this.log(`removePlatformConnection: ${hash}`);
            delete this.mPlatConnections[hash];
            this.checkRemoveSession();
        }
    }

    /**
     *
     * @param {PlatControl} platControl
     */
    removePlatformController(platControl) {
        if (this.mPlatformController == platControl) {
            this.mPlatformController = null;
        }
    }

    checkRemoveSession() {
        if (this.mPlayerConnection === null && Object.keys(this.mPlatConnections).length === 0 && Object.keys(this.mPlayerChannels).length === 0) {
            this.log(`Removing session object mPlatConnections: ${Object.keys(this.mPlatConnections).length}, mPlayerChannels: ${Object.keys(this.mPlayerChannels).length}`);
            delete sessions[this.sessionID];
        } else {
            //this.log(`checkRemoveSession mPlatConnections: ${Object.keys(this.mPlatConnections).length}, mPlayerChannels: ${Object.keys(this.mPlayerChannels).length}, this.mPlayerConnection: ${this.mPlayerConnection}`);
        }
    }

    /**
     *
     * @param {number} processID
     * @param {number} channelType
     * @param {number} channelIdx
     * @returns {PlatConn}
     */
    getPlatformConnection(processID, channelType, channelIdx) {
        const hash = this.getConnectionHash(processID, channelType, channelIdx);
        return this.mPlatConnections[hash];
    }

    /**
     *
     * @param {PlayerConn} playerConnection
     */
    async associatePlayerToPlatformController(playerConnection) {
        let platControl = await PlatControl.waitForPlatformControl(this.mPlatformKey);
        this.mPlatformController = platControl;
    }

    /**
     *
     * @param {PlayerConn} playerConnection
     */
    async associatePlatConnToPlatformController(platConnection) {
        let platControl = await PlatControl.waitForPlatformControl(this.mPlatformKey);
        if (this.mPlatformController != platControl) {
            this.mPlatformController = platControl;
            // return true so caller know we changed mPlatformController
            return true;
        } else {
            // return false so caller know we didn't change mPlatformController
            return false;
        }
    }

    async sendSyncToPlatformApps() {
        const keys = Object.keys(this.mPlatConnections);
        for (const hash of keys) {
            const platConn = this.mPlatConnections[hash];
            platConn.sendSync();
        }
    }

    async killUserAppsInPlatform() {
        const keys = Object.keys(this.mPlatConnections);
        for (const hash of keys) {
            const platConn = this.mPlatConnections[hash];
            platConn.killUserApps();
        }
    }

    /**
     * Write command to client (main connection). if client is not connected write it log queue
     * @param {*} bytesCount
     * @param {*} processId
     * @param {*} cmdcode
     * @param {*} wndId
     * @param {*} buff
     * @param {*} flushBuffer
     */
    async writeToClient(bytesCount, processId, cmdcode, wndId, buff,isFlush) {
        let playerConn = this.mPlayerConnection;
        if (playerConn) {
            await playerConn.writeToClient(bytesCount, processId, cmdcode, wndId, buff, isFlush);
            return true;
        } else {
            this.clientQ.push({
                bytesCount,
                processId,
                cmdcode,
                wndId,
                buff,
                isFlush
            });
            return false;
        }
    }

    /**
     * Send all pending commands to client after client connects
     */
    async sendClientQ() {
        let playerConn = this.mPlayerConnection;
        let arr = this.clientQ;
        if (playerConn && arr.length > 0) {
            this.clientQ = [];
            this.log(`Sending ${arr.length} pending commands`);
            for (const item of arr) {
                await playerConn.writeToClient(item.bytesCount, item.processId, item.cmdcode, item.wndId, item.buff, item.isFlush);
            }

        }
    }

    /**
     *
     * @param {PlayerConn} playerConnection
     */
    async associatePlayerWithPlatformConnectionsAndSyncApps(playerConnection) {
        await this.sendClientQ();
        const keys = Object.keys(this.mPlatConnections);
        //this.log(`associatePlayerWithPlatformConnectionsAndSyncApps.. mPlatConnections: ${keys.length}`);
        for (const hash of keys) {
            const platConn = this.mPlatConnections[hash];
            if (playerConnection.mIsAndroidClient || playerConnection.mIsIOSClient) {
                const netQ = playerConnection.mNetworkConnectionQuality;
                platConn.sendInitProcessFPS(netQ);
            }
            platConn.sendSync();
        }

    }
}

/**
 *
 * @param {String} sessionID
 * @returns {Session}
 */
function getSession(sessionID) {
    let session = sessions[sessionID];
    if (!session) {
        session = new Session(sessionID);
    }
    return session;
    /*
    if (session.validSession) {
        return session;
    }
    let valid = await session.validateSession(2);
    if (valid) {
        return session;
    } else {
        return null;
    }*/
}

module.exports = { Session, getSession };