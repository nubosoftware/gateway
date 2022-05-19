"use strict";

const PlayerCmd = Object.freeze({
    sync: -1,
    touchEvent: 1,
    keyEvent: 2,
    playerLogin: 3,
    playerDisconnected: 4,
    channelLogin: 5,
    setKeyboardHeight: 6,
    platformProcessConnected: 7,
    setKeyboardState: 8,
    orientationChange: 9,
    invalidateWindow: 10,
    goToSleep: 11, // For client version < 99
    wakeUp: 12, // For client version < 99
    clearAllCache: 13,
    clearProcessCache: 14,
    gpsLocation: 15,
    killUserApps: 16,
    roundTripData: 17,
    recentApps: 18,
    networkTestUpl: 19,

    // igor commands
    homeKeyEvent: 20,
    notificationCancel: 21,
    searchKeyEvent: 22,
    notificationOpen: 23,
    requestState: 24,

    // TODO: Uncomment
    // Video commands
    videoErrorEvent: 25,
    videoCompleteEvent: 26,
    videoBufferEvent: 27,
    videoInfoEvent: 28,
    videoSeekEvent: 29,
    videoProgress: 30,
    onVideoSizeChanged: 31,
    videoDuration: 37,

    // audio commands
    writeAudioBytes: 32,
    mediaRecorderListeners: 33,
    audioInPacket: 38,

    // Surfaces
    srfc_event: 34,
    nuboTestSocket: 35,
    authenticateNuboAppResponse: 36,

    // Keyboard commands
    txt_compose: 50,
    txt_commit: 51,
    txt_deleteText: 52,
    txt_setRegion: 53,
    txt_finishComposing: 54,
    txt_setSelection: 55,
    txt_keyEvent: 56,
    txt_editorAction: 57,

    // Camera
    camera_PictureTaken: 60,

    // Sync Contacts
    uplSyncContacts: 61,

    camera_previewFrame: 62,
    camera_callback: 63,
    sensor_callback: 64,

    // OpenGL
    gl_Return: 90,
    gl_Feedback: 91,

    // network state - sent from gw to platform
    initProcessFPS: 100,
    updateProcessFPS: 101,

    // Determine the required video bitrate
    setVideoFPS: 102,
});

const PlatformCtrlCmd = Object.freeze({
    userLogin: -1, // From player
    //        switchUser: 1, // From player
    newPlatform: 2, // From platform
    removeProcess: 3,
    changeOrientation: 4, // From player
    goToSleep: 5, // From player
    wakeUp: 6, // From player
    playerLocation: 7, // From player
    recentApps: 8, // From player
    homeEvent: 9, // From player
    roundTripData: 10, // from platform to gateway
    roundTripDataAck: 11, // From gateway to platform
    notificationOpen: 23, // From player
    notificationCancel: 21, // From player
    audioParams: 22,
    newPlatformDocker: 200, //new docker platform
});
const PlatformCtrlCmdSize = Object.freeze({
    userLoginWithService: 10703, // From player
    userLoginWithServiceConstCamera: 179,
    //        switchUser: -1, // From player
    //        newPlatform: -1, // From platform
    //        removeProcess: -1,
    changeOrientation: 16, // From player
    goToSleep: 4, // From player
    wakeUp: 4, // From player
    playerLocation: 24, // From player
    recentApps: 4, // From player
    homeEvent: 4, // From player
    //        roundTripData: -1, // From gateway or from platform
    roundTripDataAck: 8, // From gateway or from platform
});

const GWStatusCode = Object.freeze({
    errGatewayAlreadyExist: -7,
    errIllegalPlatformId: -6,
    errIllegalLoginToken: -5,
    errIllegalDeviceId: -4,
    errIllegalRedisData: -3,
    errIllegalSessionID: -2,
    errNoConnection_GW_REDIS: -1,
    OK: 0,
});

const ChannelType = Object.freeze({
    main: 0,
    video: 1,
    opengl: 2,
});

const DrawCmd = Object.freeze({

    glRenderCmd: -128,
    glAttachToWindow: -127,
    audioCmd: -126,
    mediaCodecCmd: -125,
    audioPacket: -121,
    openGLVideoPacket: -120,

    setDirtyRect: 1,
    drawColor1: 2,
    saveLayer: 3,
    restoreLayer: 4,
    drawText: 5,
    drawText1: 6,
    drawRect: 7,
    drawBitmap: 8,
    saveLayerAlpha: 9,
    drawColor2: 10,
    drawLine: 11,
    drawLines: 12,
    drawRect1: 13,
    drawRoundRect: 14,
    drawBitmap1: 15,
    setDensity: 16,
    drawTextRun: 17,
    ninePatchDraw: 18,
    drawBitmap6: 19,
    drawPosText1: 20,
    drawPosText2: 21,
    drawBitmap8: 22,
    drawPlayerLoginAck: 23,
    toast: 24,
    drawBitmapMatrix: 25,
    drawPath: 26,

    // immediate draw commands
    IMMEDIATE_COMMAND: 70, // dummy command
    nuboTestSocketAck: 84,
    networkTestUplReply: 99,
    networkTestDnl: 100,
    writeTransaction: 101,
    pushWindow: 102,
    popWindow: 103,
    showWindow: 104,
    hideWindow: 105,
    // public static final int drawWebView: 106,
    showSoftKeyboard: 107,
    prepKeyboardLayout: 108,
    removeProcess: 109,
    setWndId: 110,
    initPopupContentView: 111,
    updatePopWindow: 112,
    // igor commands
    wallpaperOffset: 113,
    toggleMenu: 114,
    toggleSearch: 115,
    wallpaperID: 116,
    incomingNotification: 117,

    // NON-igor command :-)
    resizeWindow: 118,
    sendKeyboardExtractedText: 119,
    updateScreenOrientation: 120,
    clearProcessCacheAck: 121,
    prepareViewCache: 122,
    roundTripDataAck: 123,
    outgoingCall: 124,
    setTopTask: 125,
    setWindowPos: 126,


    // israel - audio commands
    nuboAudioPacket: 127,
});

module.exports = {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
    ChannelType,
};