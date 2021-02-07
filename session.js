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
        this.mPlatConnections = [];
        sessions[sessionID] = this;
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    async validateSession(suspend, doNotRefreshData) {

        let response = await mgmtCall.get({
            url: "/redisGateway/validateUpdSession?session=" + this.sessionID + "&suspend=" + suspend,
        });
        if (doNotRefreshData) {
            // we use this only to change suspend values
            return false;
        }
        //this.log("validateSession. response: " + JSON.stringify(response.data, null, 2));
        if (response.data.status == OK) {
            this.validSession = true;
            this.sessionParams = response.data.session;
            //this.log("Session found. Params: " + JSON.stringify(this.sessionParams, null, 2));
            this.mUserId = this.sessionParams.localid;
            this.mPlatformId = this.sessionParams.platid;
            this.email = this.sessionParams.email;
            this.mPlatformController = await PlatControl.waitForPlatformControl(this.mPlatformId);
            this.validSession = true;
        } else {

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
        if (this.mPlayerConnection == null && Object.keys(this.mPlatConnections).length == 0 &&
            Object.keys(this.mPlayerChannels).length == 0) {
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
        let platControl = await PlatControl.waitForPlatformControl(playerConnection.mPlatformId);
        this.mPlatformController = platControl;
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
     * 
     * @param {PlayerConn} playerConnection 
     */
    associatePlayerWithPlatformConnectionsAndSyncApps(playerConnection) {
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