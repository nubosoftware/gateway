"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const NetConn = require('./netConn');
const { Session, getSession } = require('./session');
const jwt = require('jsonwebtoken');
const mgmtCall = require('./mgmtCall');
const CompressedStream = require('./compressedStream');

const {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
} = require('./constants');


const UPL_CONTROLLER_CMD_HEADER_SIZE = 5;
const UPL_APP_CMD_HEADER_SIZE = 9;
const MAX_QUALITY_NETWORK_TIME = 30; // max time in sec
// to continue
// network test
const MAX_BYTES_COUNT_SIZE = 10 * 1024 * 1024; // max
// allowed
// data
// size is
// 10MB
const MAX_NUMBER_OF_CAMERAS = 10 + 1; // 10 real cameras
// info and 11th
// constant camera
// info
const LOGIN_ACK_SIZE_WITH_COMPRESS = 18;

const ROM_TYPE_ANDROID = 0;
const ROM_TYPE_IOS = 1;
const ROM_TYPE_WEB = 2;
const ROM_TYPE_MASK = 0x000000FF;

const CMD_HEADER_SIZE = 13;

const COMPRESSION_BUFFER_SIZE = 64 * 1000;

const SESSION_ID_SIZE = 96;
const ADDITION_TO_STRING_LENGTH = 3;
const NUM_OF_CAMERAS = 3;


let playerConnectionsByTokens = {};
let playerConnectionByPlatformUser = {}
class PlayerConn extends NetConn {
    /**
     * 
     * @param {net.Socket} socket 
     */
    constructor(socket) {
        super(socket);
        this.sessionParams = {};
        this.runPlayerConn();
    }


    async runPlayerConn() {
        this.log(`runPlayerConn`);
        this.mStopThread = false;
        this.mIsReadBytesCount = false;
        try {

            while (!this.mStopThread) {
                await this.handlePlayer2PlatformCommands();
            }
        } catch (err) {
            logger.error(`${this.TAG}: Error`, err);
        }
        await this.removePlayerConnection();
        if (!this.socket.destroyed) {
            try {
                this.socket.destroy();
            } catch (err) {

            }
        }

        logger.info(`${this.TAG}: finished.`);
    }

    isValidSessionId(sessionId) {
        if (!sessionId || !this.mSessionId || sessionId == "" || this.mSessionId != sessionId) {
            return false;
        } else {
            return true;
        }
    }
    async handlePlayer2PlatformCommands() {
        let bytesCount;
        let iPlayerCmd;
        let sessionId;
        let isValidSessionId = true;
        const pc = this;
        this.log(`handlePlayer2PlatformCommands.`);

        if (this.mIsReadBytesCount) {
            bytesCount = await pc.readInt();
            iPlayerCmd = await pc.readByte();
            if (iPlayerCmd != PlayerCmd.playerLogin && iPlayerCmd != PlayerCmd.channelLogin &&
                (bytesCount < UPL_CONTROLLER_CMD_HEADER_SIZE || bytesCount > MAX_BYTES_COUNT_SIZE)) {
                logger.info(`${this.TAG}: handlePlayer2PlatformCommands. Illegal bytesCount. Disconnecting user. bytesCount: ${bytesCount}`);
                this.mStopThread = true;
                return;
            }
        } else {
            iPlayerCmd = await pc.readInt();
        }
        //this.log(`handlePlayer2PlatformCommands. iPlayerCmd: ${iPlayerCmd}, bytesCount: ${bytesCount}`);
        if (iPlayerCmd != PlayerCmd.playerLogin && iPlayerCmd != PlayerCmd.nuboTestSocket && iPlayerCmd != PlayerCmd.channelLogin) {
            sessionId = await pc.readString();
            //this.log(`handlePlayer2PlatformCommands. sessionId: ${sessionId}`);
            isValidSessionId = pc.isValidSessionId(sessionId);
        }

        if (!isValidSessionId && iPlayerCmd != PlayerCmd.roundTripData) {
            logger.info(`${this.TAG}: Invalid sessionID: ${sessionId}`);
            this.mStopThread = true;
            return;
        }

        switch (iPlayerCmd) {
            case PlayerCmd.touchEvent:
            case PlayerCmd.txt_compose:
            case PlayerCmd.txt_commit:
            case PlayerCmd.txt_deleteText:
            case PlayerCmd.txt_setRegion:
            case PlayerCmd.txt_finishComposing:
            case PlayerCmd.txt_setSelection:
            case PlayerCmd.txt_keyEvent:
            case PlayerCmd.txt_editorAction:
            case PlayerCmd.keyEvent:
            case PlayerCmd.videoErrorEvent:
            case PlayerCmd.videoCompleteEvent:
            case PlayerCmd.videoBufferEvent:
            case PlayerCmd.videoInfoEvent:
            case PlayerCmd.videoSeekEvent:
            case PlayerCmd.videoProgress:
            case PlayerCmd.onVideoSizeChanged:
            case PlayerCmd.videoDuration:
            case PlayerCmd.writeAudioBytes:
            case PlayerCmd.mediaRecorderListeners:
            case PlayerCmd.setKeyboardHeight:
            case PlayerCmd.setKeyboardState:
            case PlayerCmd.searchKeyEvent:
            case PlayerCmd.requestState:
            case PlayerCmd.invalidateWindow:
            case PlayerCmd.clearAllCache:
            case PlayerCmd.clearProcessCache:
            case PlayerCmd.camera_PictureTaken:
            case PlayerCmd.uplSyncContacts:
            case PlayerCmd.gl_Return:
            case PlayerCmd.gl_Feedback:
            case PlayerCmd.camera_previewFrame:
            case PlayerCmd.camera_callback:
            case PlayerCmd.sensor_callback:
            case PlayerCmd.srfc_event:
            case PlayerCmd.authenticateNuboAppResponse:
                await pc.sendCmdToApplication(iPlayerCmd, bytesCount);
                break;
            case PlayerCmd.notificationCancel:
            case PlayerCmd.notificationOpen:
                await pc.sendCmdToPlatformController(iPlayerCmd, bytesCount, 0);
                break;
            case PlayerCmd.orientationChange:
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.changeOrientation, bytesCount,
                    PlatformCtrlCmdSize.changeOrientation);
                break;
            case PlayerCmd.goToSleep:
                this.DEBUG = true;
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.goToSleep, bytesCount, PlatformCtrlCmdSize.goToSleep);
                break;
            case PlayerCmd.wakeUp:
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.wakeUp, bytesCount, PlatformCtrlCmdSize.wakeUp);
                break;
            case PlayerCmd.recentApps:
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.recentApps, bytesCount, PlatformCtrlCmdSize.recentApps);
                break;
            case PlayerCmd.gpsLocation:
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.playerLocation, bytesCount,
                    PlatformCtrlCmdSize.playerLocation);
                break;
            case PlayerCmd.playerLogin:
                await pc.handlePlayerLogin(bytesCount);
                break;
            case PlayerCmd.channelLogin:
                await pc.handleChannelLogin(bytesCount);
                break;
            case PlayerCmd.audioInPacket:
                await pc.handleAudioInPacket();
                break;
            case PlayerCmd.sync:
                await pc.sendSyncToPlatform();
                break;
            case PlayerCmd.killUserApps:
                await pc.killUserAppsInPlatform(this.mSessionId);
                break;
            case PlayerCmd.roundTripData:
                await pc.handleRoundTripData(isValidSessionId);
                break;
            case PlayerCmd.networkTestUpl:
                await pc.handleNetworkTestUpl();
                break;
            case PlayerCmd.nuboTestSocket:
                // This only works on Android clients for now.
                await pc.handleTestSocketData();
                break;
            case PlayerCmd.homeKeyEvent:
                let doNothing = await pc.readInt();
                await pc.sendCmdToPlatformController(PlatformCtrlCmd.homeEvent, bytesCount - 4, PlatformCtrlCmdSize.homeEvent);
                break;
            default:
                pc.log("Illegal cmdCode in handlePlayer2PlatformCommands. Disconnecting user. CMD=" + iPlayerCmd);
                this.mStopThread = true;
                break;
        }
    }

    async sendCmdToPlatformController(cmdCode, bytesCount, controllerBytesCount) {
        //this.log(`sendCmdToPlatformController. cmdCode: ${cmdCode}, bytesCount: ${bytesCount}`);
        const headerSize = UPL_CONTROLLER_CMD_HEADER_SIZE + SESSION_ID_SIZE + ADDITION_TO_STRING_LENGTH;
        let data = null;
        if (bytesCount - headerSize > 0) {
            data = await this.readChunk(bytesCount - headerSize);
        }
        const pc = this.mSession.mPlatformController;
        if (pc != null) {
            pc.writeQ.push(async() => {
                await pc.writeInt(controllerBytesCount);
                await pc.writeInt(cmdCode);
                await pc.writeString(this.mSessionId);
                await pc.writeInt(this.mUserId);
                if (data) {
                    await pc.writeChunk(data);
                }
            });

        }
        /*
        final byte[] cmdData = data;
	    handleSendCmdToPlatform(cmdCode, controllerBytesCount, cmdData);
        */
        this.log(`sending command to platform controller`);
    }
    async sendCmdToApplication(cmdCode, bytesCount) {
        //this.log(`sendCmdToApplication. cmdCode: ${cmdCode}, bytesCount: ${bytesCount}`);
        const processId = await this.readInt();
        /*
        if (mNetworkStats != null && mNuboVersionCode >= CLIENT_VERSION_WITH_NETWORK_STATS && processId > 0 &&
            bytesCount > 0) {
            mNetworkStats.addGWRxBytes(processId, bytesCount);
        }*/

        const headerSize = UPL_APP_CMD_HEADER_SIZE + SESSION_ID_SIZE + ADDITION_TO_STRING_LENGTH;



        let data = null;
        if (bytesCount - headerSize > 0) {
            data = await this.readChunk(bytesCount - headerSize);
        }

        //this.log(`sending command with ${data.length} bytes data to process ${processId}`);
        const pc = this.mSession.getPlatformConnection(processId, this.mChannelType, this.mChannelIdx);
        if (pc) {
            pc.writeQ.push(async() => {
                await pc.writeInt(cmdCode);
                await pc.writeString(this.mSessionId);
                if (data != null) {
                    await pc.writeChunk(data);
                }
            });
        } else {
            this.log("Try send command " + cmdCode + " to unavalible pid " + processId);
        }


    }

    setCompressStream() {
        this.compressedStream = new CompressedStream(this.socket);
        this.compressedStream.compressedInput = true;
        this.compressedOutput = true;
    }

    async handleChannelLogin(bytesCount) {
        this.mPlayerId = await this.readInt();
        this.mSessionId = await this.readString();
        this.mChannelProcess = await this.readInt();
        this.mChannelType = await this.readInt();
        this.mChannelIdx = await this.readInt();
        this.mRomClientType = await this.readInt();
        this.mIsAndroidClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_ANDROID);
        this.mIsWebClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_WEB);
        this.mIsIOSClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_IOS);
        //this.mClientWriter.setClientType(mRomClientType);
        this.mRomSdkVersion = await this.readInt();
        this.mRomBuildVersion = await this.readString();
        this.mNuboClientVersion = await this.readString();
        this.mNuboProtocolVersion = await this.readString();
        this.mNuboVersionCode = await this.readInt();
        this.log(" handleChannelLogin. mChannelIdx: " + this.mChannelIdx + ", mChannelType: " + this.mChannelType);
        if (this.mChannelType == 0) {
            logger.error(`${this.TAG}: Invalid channel type for channel login: ${this.mChannelType}`);
            this.mStopThread = true;
            return;
        }
        this.mIsReadBytesCount = true;

        //this.compressedStream.compressedInput = true;
        //this.compressedOutput = true;

        const session = getSession(this.mSessionId);
        if (!session.validSession) {
            let valid = await session.validateSession(2);
        }
        if (!session || !session.validSession) {
            replyErrorOnLoginToPlayer(GWStatusCode.errIllegalSessionID);
            log("PlayerConnection::handleChannelLogin cannot get valid data from managment server");
            this.mStopThread = true;
            return;
        }
        this.mSession = session;
        if (this.mChannelType == 4) {
            this.rtpAudioUpInetAddress = session.sessionParams.platform_ip;
            this.rtpAudioUpPort = session.sessionParams.audioStreamPort;
            this.log("PlayerConnection::handlePlayerLoginOnPlatform. rtpAudioUpInetAddress: " + this.rtpAudioUpInetAddress + ", rtpAudioUpPort: " + this.rtpAudioUpPort);
        }

        session.addPlayerConnection(this);

        let buf = Buffer.alloc(5);
        buf.writeInt32BE(GWStatusCode.OK);
        buf.writeInt8(1, 4);
        await this.writeToClient(LOGIN_ACK_SIZE_WITH_COMPRESS, -1,
            DrawCmd.drawPlayerLoginAck, -1, buf, true);

        this.setCompressStream();

    }

    async handlePlayerLogin(bytesCount) {
        this.log(`handlePlayerLogin`);
        this.mPlayerId = await this.readInt();
        this.mChannelType = 0;
        this.mChannelIdx = 0;
        this.mSessionId = await this.readString();
        this.mWidth = await this.readInt();
        this.mHeight = await this.readInt();
        this.mDensityDpi = await this.readInt();
        this.mXDpi = await this.readFloat();
        this.mYDpi = await this.readFloat();
        this.mScaledDensity = await this.readFloat();
        this.mRotation = await this.readInt();
        this.mNavBarHeightPortrait = await this.readInt();
        this.mNavBarHeightLandscape = await this.readInt();
        this.mNavBarWidth = await this.readInt();
        this.mRomClientType = await this.readInt();
        //this.log(`handlePlayerLogin. this.mRomClientType: ${this.mRomClientType}`);
        this.mIsAndroidClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_ANDROID);
        this.mIsWebClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_WEB);
        this.mIsIOSClient = ((this.mRomClientType & ROM_TYPE_MASK) == ROM_TYPE_IOS);
        //mClientWriter.setClientType(mRomClientType);
        this.mRomSdkVersion = await this.readInt();
        this.mRomBuildVersion = await this.readString();
        this.mNuboClientVersion = await this.readString();
        this.mNuboProtocolVersion = await this.readString();
        this.mNuboVersionCode = await this.readInt();
        this.log(`handlePlayerLogin. this.mNuboVersionCode: ${this.mNuboVersionCode}, mIsAndroidClient: ${this.mIsAndroidClient}`);
        //mClientWriter.setNuboVersionCode(mNuboVersionCode);
        this.mAllocatedCacheSize = await this.readInt();
        this.mPendingIntentType = await this.readInt();
        //this.log(`handlePlayerLogin. before camera. this.mPendingIntentType: ${this.mPendingIntentType}`);
        if (this.mIsWebClient || this.mIsAndroidClient) {
            this.mDataIntent = await this.readString();
        }

        this.log(`handlePlayerLogin. before camera. this.mIsWebClient: ${this.mIsWebClient}`);
        // Handle camera info as part of login process
        if (!this.mIsWebClient) {
            //this.log(`handlePlayerLogin. read cameras...`);
            this.mNumberOfCameras = await this.readInt();
            this.log("mNumberOfCameras: " + this.mNumberOfCameras);

            let isValidNumOfCameras = true;

            if (this.mNumberOfCameras < 0 || this.mNumberOfCameras > MAX_NUMBER_OF_CAMERAS) {
                isValidNumOfCameras = false;
            }


            if (!isValidNumOfCameras) {
                this.log("handlePlayerLogin. Illegal number of cameras: " + mNumberOfCameras +
                    ". Disconnect user: " + this);
                this.mStopThread = true;
                return;
            }

            if (this.mNumberOfCameras > 0 && this.mNumberOfCameras < MAX_NUMBER_OF_CAMERAS) {
                this.mDeviceCamerasInfo = [];
                for (let i = 0; i < this.mNumberOfCameras; ++i) {
                    const cameraInfo = {};
                    cameraInfo.facing = await this.readInt();
                    cameraInfo.orientation = await this.readInt();
                    cameraInfo.parameters = await this.readString();
                    this.mDeviceCamerasInfo.push(cameraInfo);
                }
            }
        }

        if ((this.mIsIOSClient || this.mIsAndroidClient)) {
            this.mNetworkConnectionQuality = await this.readInt();
        }

        this.mDeviceId = await this.readString();



        this.mNuboFlags = await this.readInt();
        this.mHideAppPackageName = await this.readString();

        this.log(`handlePlayerLogin. read all params`);

        this.mIsReadBytesCount = true;

        //this.compressedStream.compressedInput = true;
        //this.compressedOutput = true;



        this.sessionParams.mWidth = this.mWidth;
        this.sessionParams.mHeight = this.mHeight;
        // ////////

        if (!this.mSessionId || this.mSessionId == "") {
            this.log("Illegal sessionid in handlePlayerLogin sessionId: " + mSessionId);
            this.mStopThread = true;
            return;
        }


        const session = getSession(this.mSessionId);
        if (!session.validSession) {
            let valid = await session.validateSession(2);
        }
        if (!session || !session.validSession) {
            replyErrorOnLoginToPlayer(GWStatusCode.errIllegalSessionID);
            log("PlayerConnection::handlePlayerLoginOnPlatform cannot get valid data from managment server");
            this.mStopThread = true;
            return;
        }
        this.mSession = session;
        session.addPlayerConnection(this);
        let token = jwt.sign({ sub: session.email }, this.mSessionId, { algorithm: 'HS384' });
        if (this.mPlayerToken && this.mPlayerToken != token) {
            delete playerConnectionsByTokens[this.mPlayerToken];
        }
        playerConnectionsByTokens[token] = this;
        this.mPlayerToken = token;
        let audioToken = session.sessionParams.audioToken;
        if (audioToken) {
            if (this.mPlayerAudioToken && this.mPlayerAudioToken != audioToken) {
                delete playerConnectionsByTokens[this.mPlayerAudioToken];
            }
            playerConnectionsByTokens[audioToken] = this;
            this.mPlayerAudioToken = audioToken;
        }
        this.rtpAudioUpInetAddress = session.sessionParams.platform_ip;
        this.rtpAudioUpPort = session.sessionParams.audioStreamPort;

        this.setCompressStream();

        await this.handlePlayerLoginOnPlatform(session);


        await session.validateSession(0, true);

        await session.sendSyncToPlatformApps();


    }

    /**
     * 
     * @param {Session} session 
     */
    async handlePlayerLoginOnPlatform(session) {
        this.mUserId = session.mUserId;
        this.email = session.email;
        this.mPlatformId = session.mPlatformId;
        this.log(`handlePlayerLoginOnPlatform. mPlatformId: ${this.mPlatformId}`);
        await session.associatePlayerToPlatformController(this);
        if (session.mPlatformController == null) {
            this.log("PlayerConnection::handlePlayerLoginOnPlatform cannot find platform");
            //PlatformControllerFailThreshold.getInstance().incPlatformFails(this.mPlatformId);
            this.mStopThread = true;
            return;
        }
        const platformUserKey = ((this.mPlatformId & 0xFFFF) << 16) | (this.mUserId & 0xFFFF);
        playerConnectionByPlatformUser[platformUserKey] = this;
        this.log(`handlePlayerLoginOnPlatform. send login ack: ${(this.mIsAndroidClient || this.mIsIOSClient)}`);
        if (this.mIsAndroidClient || this.mIsIOSClient) {
            let buf = Buffer.alloc(5);
            buf.writeInt32BE(GWStatusCode.OK);
            buf.writeInt8(1, 4);
            await this.writeToClient(LOGIN_ACK_SIZE_WITH_COMPRESS, -1,
                DrawCmd.drawPlayerLoginAck, -1, buf, true);
        } else {
            let buf = Buffer.alloc(4);
            buf.writeInt32BE(GWStatusCode.OK);
            await this.writeToClientOld(8, PlatformConnection.DrawCmd.drawPlayerLoginAck,
                buf, true);
        }
        session.associatePlayerWithPlatformConnectionsAndSyncApps(this);
        session.mPlatformController.addPlayerConnection(this);


        await session.mPlatformController.writeQ.push(async() => {
            this.log("Send login to mPlatformController..");
            if (this.mNumberOfCameras > 0 && this.mNumberOfCameras < MAX_NUMBER_OF_CAMERAS) {
                await session.mPlatformController.writeInt(PlatformCtrlCmdSize.userLoginWithService);
            } else {
                await session.mPlatformController.writeInt(PlatformCtrlCmdSize.userLoginWithServiceConstCamera);
            }

            await session.mPlatformController.writeInt(PlatformCtrlCmd.userLogin);
            await session.mPlatformController.writeString(this.mSessionId);
            await session.mPlatformController.writeInt(this.mUserId);
            // EB@NUBO: Whenever a user logs in, the width, height,
            // density and scale are sent
            await session.mPlatformController.writeInt(this.mWidth);
            await session.mPlatformController.writeInt(this.mHeight);
            await session.mPlatformController.writeInt(this.mDensityDpi);
            await session.mPlatformController.writeFloat(this.mXDpi);
            await session.mPlatformController.writeFloat(this.mYDpi);
            await session.mPlatformController.writeFloat(this.mScaledDensity);
            await session.mPlatformController.writeInt(this.mRotation);
            await session.mPlatformController.writeInt(this.mNavBarHeightPortrait);
            await session.mPlatformController.writeInt(this.mNavBarHeightLandscape);
            await session.mPlatformController.writeInt(this.mNavBarWidth);
            await session.mPlatformController.writeInt(this.mRomClientType);
            await session.mPlatformController.writeInt(this.mRomSdkVersion);
            await session.mPlatformController.writeString(this.mRomBuildVersion);
            await session.mPlatformController.writeString(this.mNuboClientVersion);
            await session.mPlatformController.writeString(this.mNuboProtocolVersion)
            await session.mPlatformController.writeInt(this.mNuboVersionCode);
            await session.mPlatformController.writeInt(this.mAllocatedCacheSize);
            await session.mPlatformController.writeInt(this.mPendingIntentType);
            if (this.mIsWebClient || this.mIsAndroidClient) {
                await session.mPlatformController.writeString(this.mDataIntent);
            }
            // Handle camera info
            if (this.mNumberOfCameras != -1) {
                await session.mPlatformController.writeInt(this.mNumberOfCameras);
                if (this.mNumberOfCameras > 0 && this.mNumberOfCameras < MAX_NUMBER_OF_CAMERAS) {
                    for (let i = 0; i < this.mNumberOfCameras; ++i) {
                        await session.mPlatformController.writeInt(this.mDeviceCamerasInfo[i].facing);
                        await session.mPlatformController.writeInt(this.mDeviceCamerasInfo[i].orientation);
                        await session.mPlatformController.writeString(this.mDeviceCamerasInfo[i].parameters);
                    }
                }
            }
            // handle network stats
            if (this.mIsIOSClient || this.mIsAndroidClient) {
                await session.mPlatformController.writeInt(this.mNetworkConnectionQuality);
            }
            // ////////


            await session.mPlatformController.writeInt(this.mNuboFlags);
            await session.mPlatformController.writeString(this.mHideAppPackageName);
        });


    }

    async replyErrorOnLoginToPlayer(statusCode) {
        if (statusCode >= 0) {
            this.log("replyErrorOnLoginToPlayer. Illegal statuCode: " + statusCode);
            return;
        }

        if (this.mIsAndroidClient || this.mIsIOSClient) {
            let buf = Buffer.alloc(5);
            buf.writeInt32BE(statusCode);
            buf.writeInt8(1, 4);
            await this.writeToClient(LOGIN_ACK_SIZE_WITH_COMPRESS, -1,
                DrawCmd.drawPlayerLoginAck, -1, buf, true);
        } else {
            let buf = Buffer.alloc(4);
            buf.writeInt32BE(statusCode);
            await this.writeToClientOld(8, PlatformConnection.DrawCmd.drawPlayerLoginAck,
                buf, true);
        }
    }

    async removePlayerConnection() {
        if (!this.mIsDuplicatedSession && this.mSession) {
            await this.mSession.validateSession(1, true);
        }

        if (this.mSession && this.mSession.mPlatformController) {
            this.mSession.mPlatformController.removePlayerConnection(this);
        }
        if (this.mSession) {
            this.mSession.removePlayerConnection(this);
        }

        if (this.mPlayerToken && playerConnectionsByTokens[this.mPlayerToken] == this) {
            delete playerConnectionsByTokens[this.mPlayerToken];
        }

        if (this.mPlayerAudioToken && playerConnectionsByTokens[this.mPlayerAudioToken] == this) {
            delete playerConnectionsByTokens[this.mPlayerAudioToken];
        }

        const platformUserKey = ((this.mPlatformId & 0xFFFF) << 16) | (this.mUserId & 0xFFFF);
        if (playerConnectionByPlatformUser[platformUserKey] == this) {
            delete playerConnectionByPlatformUser[platformUserKey];
        }


    }

    async handleAudioInPacket() {
        let data = await this.readByteArr();
        this.log(`handleAudioInPacket. size: ${data.length}`);
    }

    async sendSyncToPlatform() {
        if (this.mSession) {
            await this.mSession.sendSyncToPlatformApps();
        }
    }

    async killUserAppsInPlatform() {
        if (this.mSession) {
            await this.mSession.killUserAppsInPlatform();
        }
    }

    async handleRoundTripData(isValidSessionId) {
        let processId;
        let wndId;
        let sendTime;
        let clientRxKbps = -1; //NetworkStats.IGNORE_DYNAMIC_FPS;

        /*if (mChannelType != 0) {
            Log.e(TAG+" handleRoundTripData...");
        }*/

        //this.log("handleRoundTripData");


        processId = await this.readInt();
        wndId = await this.readInt();
        sendTime = await this.readLong();
        if (this.mIsIOSClient || this.mIsAndroidClient) {
            clientRxKbps = await this.readLong();
        }
        /*if (mChannelType == 0) {
            Log.e(TAG+" handleRoundTripData. clientRxKbps: "+clientRxKbps+", sendTime: "+sendTime+", wndId: "+wndId+", processId: "+processId);
        }*/


        if (!isValidSessionId) {
            this.log("handleRoundTripData. Invalid session id. Ignoring command!!!");
            return;
        }

        let buf = Buffer.alloc(8);
        buf.writeBigInt64BE(sendTime);

        await this.writeToClient(21, -1,
            DrawCmd.roundTripDataAck, -1, buf, true);


        // writeRTTToPlatform(processId, wndId, sendTime);

        // handle platform process FPS
        /*
        if ((mIsIOSClient || mIsAndroidClient) && mNuboVersionCode >= CLIENT_VERSION_WITH_NETWORK_STATS && mChannelType == 0) {
            if (mRttDiff > 0) {
                long timeDiff = System.currentTimeMillis() - mRttDiff;
                if (timeDiff < 1000 - RTT_MILLISEC_MARGIN || timeDiff > 1000 + RTT_MILLISEC_MARGIN) {
                    // round trip is delayed on client. That might indicate that
                    // UI thread is busy
                    // due to slow network network (buffering of UI draw
                    // commands).
                    // In that case, do not increase refresh rate
                    mNetworkStats.setIsBadRTT(true);
                } else {
                    mNetworkStats.setIsBadRTT(false);
                }
            }
            mRttDiff = System.currentTimeMillis();
            mNetworkStats.updateRxTxPerSecData(processId, clientRxKbps);
        }*/
    }

    /**
     * 
     * @param {boolean} playbackStarted 
     * @param {number} playbackStreamType 
     * @param {boolean} recordStarted 
     * @param {number} recordInputSource 
     * @param {boolean} speakerPhoneOn 
     */
    async sendAudioParams(playbackStarted, playbackStreamType, recordStarted,
        recordInputSource, speakerPhoneOn) {

        let buf = Buffer.alloc((4 * 2) + 3);
        buf.writeInt8(playbackStarted ? 1 : 0);
        buf.writeInt32BE(playbackStreamType, 1);
        buf.writeInt8(recordStarted ? 1 : 0, 5);
        buf.writeInt32BE(recordInputSource, 6);
        buf.writeInt8(speakerPhoneOn ? 1 : 0, 10);
        const dataSize = CMD_HEADER_SIZE + buf.length;
        await this.writeToClient(dataSize, -1,
            DrawCmd.audioCmd, -1, buf, true);
    }

    async handleNetworkTestUpl() {

    }

    async handleTestSocketData() {

    }



    /**
     * 
     * @param {Buffer} data 
     * @param {*} bytesCount 
     * @param {*} processId 
     * @param {*} cmdcode 
     * @param {*} wndId 
     */
    copyCmdHeaderToBuffer(data, bytesCount, processId, cmdcode, wndId) {
        data.writeInt32BE(bytesCount, 0);
        data.writeInt32BE(processId, 4);
        data.writeInt8(cmdcode, 8);
        data.writeInt32BE(wndId, 9);
    }

    /**
     * 
     * @param {*} bytesCount 
     * @param {*} processId 
     * @param {*} cmdcode 
     * @param {*} wndId 
     * @param {Buffer} args 
     */
    async writeToClient(bytesCount, processId, cmdcode, wndId, buff, flushBuffer) {

        let offset = CMD_HEADER_SIZE;
        const data = Buffer.allocUnsafe(bytesCount);
        this.copyCmdHeaderToBuffer(data, bytesCount, processId, cmdcode, wndId);
        if (buff) {
            buff.copy(data, offset);
        }
        let writeUnCompressed = false;
        if (data.length > 200 && (cmdcode == DrawCmd.drawBitmap ||
                cmdcode == DrawCmd.drawBitmap1 ||
                cmdcode == DrawCmd.drawBitmap6 ||
                cmdcode == DrawCmd.drawBitmap8 ||
                cmdcode == DrawCmd.ninePatchDraw ||
                cmdcode == DrawCmd.openGLVideoPacket ||
                cmdcode == DrawCmd.networkTestDnl) ||
            data.length > COMPRESSION_BUFFER_SIZE) {
            writeUnCompressed = true;
        }
        await this.writeQ.push(async() => {

            await this.writeChunk(data, writeUnCompressed);
            if (flushBuffer) {
                await this.compressAndSend();
            }
        });
    }

    /**
     * 
     * @param {*} bytesCount 
     * @param {*} cmdcode 
     * @param {Buffer} buf 
     */
    async writeToClientOld(bytesCount, cmdcode, buf, flushBuffer) {
        const data = Buffer.alloc(bytesCount);
        data.writeInt32BE(cmdcode);
        let offset = 4;
        if (buff) {
            buff.copy(data, offset);
        }
        await this.writeQ.push(async() => {
            await this.writeChunk(data, writeUnCompressed);
            if (flushBuffer) {
                await this.compressAndSend();
            }
        });
    }
}



module.exports = PlayerConn;