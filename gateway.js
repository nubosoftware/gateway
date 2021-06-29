"use strict";

const Common = require('./common.js');
const NetService = require('./netService');
let secureCtx;
const PlayerConn = require('./playerConn');
const PlatControl = require('./platControl');
const PlatConn = require('./platConn');
const { PlatformRTPService } = require('./platformRTPService');
const { PlayerRTPSocket } = require('./playerRTPSocket');
const mgmtCall = require('./mgmtCall');
const tls = require('tls');
const process = require('process');

const {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
} = require('./constants');
async function loadSecureContext() {
    const readFile = require('fs').promises.readFile;
    if (Common.settings.tlsOptions) {
        Common.settings.tlsOptions.key = await readFile(Common.settings.tlsOptions.keyfile);
        Common.settings.tlsOptions.cert = await readFile(Common.settings.tlsOptions.certfile);
        if (Common.settings.tlsOptions.cafile) {
            logger.info("Loading cafile..");
            Common.settings.tlsOptions.ca = await readFile(Common.settings.tlsOptions.cafile);
        }
        secureCtx = tls.createSecureContext(Common.settings.tlsOptions);
    }
}
let logger;
async function main() {

    try {

        await Common.init();
        logger = Common.logger(__filename);
        logger.info("Start gateway", {mtype: "important"});

        // setup exception handler
        process.on('uncaughtException', (err, origin) => {
            console.log(`gateway.js. uncaughtException: ${err.message}`);
            logger.info(`uncaughtException: ${err.message}, Stack: ${err.stack}`);
        });

        // change default number of _maxListeners
        require('events').EventEmitter.prototype._maxListeners = 100;

        let reloadSettings = async() => {
            logger.info("Settings reloaded...");
            await loadSecureContext();
            Common.settingsReload.then(reloadSettings);
        }
        Common.settingsReload.then(reloadSettings);
        await loadSecureContext();

        let platformControlService = new NetService((Common.settings.platformControlPort ? Common.settings.platformControlPort : 8891), PlatControl);
        await platformControlService.listen();

        let platformConnService = new NetService((Common.settings.platformPort ? Common.settings.platformPort : 8890), PlatConn);
        await platformConnService.listen();

        if (Common.settings.playerPort && Common.settings.playerPort > 0) {
            let playerService = new NetService(Common.settings.playerPort, PlayerConn);
            await playerService.listen();
            await registerGateway(playerService, false);
        } else {
            let tlsOptions = //Common.settings.tlsOptions;
            {
                SNICallback: (servername, cb) => {
                    logger.info(`SNICallback. servername: ${servername}`)
                    cb(null, secureCtx);
                }
            };
            let playerService = new NetService(Common.settings.sslPlayerPort, PlayerConn, tlsOptions);
            await playerService.listen();
            await registerGateway(playerService, true);
        }

        let platformRTPService = new PlatformRTPService(60005);

        let playerRTPSocket = new PlayerRTPSocket(50005);

        logger.info("end of gateway!", {mtype: "important"});

    } catch (err) {
        if (logger) {
            logger.error("Error", err);
        } else {
            console.error(err);
        }
    }
}

let registeredGWs = 0;

async function registerGateway(service, isSsl) {
    const data = Common.settings;

    let external_ip,port,ssl;
    if (data.external_url && data.external_url != "") {
        const exURL = new URL(data.external_url);
        external_ip = exURL.hostname;
        port = exURL.port;
        ssl = (exURL.protocol == "ssl:" ? "true" : "false");
    } else {
        external_ip = data.external_ip;
        port = service.port;
        ssl = (isSsl ? "true" : "false");
    }
    let url = "/redisGateway/registerGateway?baseIndex=" + data.base_index + "&offset=" + registeredGWs;
    url = url + "&internal_ip=" + data.internal_ip;
    url = url + "&controller_port=" + (data.platformControlPort ? data.platformControlPort : 8891 );
    url = url + "&apps_port=" + (data.platformPort ? data.platformPort : 8890 );
    url = url + "&external_ip=" + external_ip;
    url = url + "&player_port=" + port;
    url = url + "&ssl=" + ssl;

    let response = await mgmtCall.get({
        url,
    });

    if (response.data.status == GWStatusCode.OK) {
        let gwIdx = response.data.gwIdx;
        registeredGWs++;
        setInterval(() => {
            updateGWTTL(gwIdx);
        }, 5000);
        return gwIdx;
    } else {
        logger.error(`Cannot register gateway. status: ${response.data.status}, msg: ${response.data.msg}`);
        return GWStatusCode.errIllegalRedisData;
    }
}

async function updateGWTTL(idx) {
    const data = Common.settings;
    const url = "/redisGateway/updateGatewayTtl?idx=" + idx + "&ttl=240&internal_ip=" +
        data.internal_ip;
    try {
        let response = await mgmtCall.get({
            url,
        });

        if (response.data.status == GWStatusCode.OK) {
            //logger.info("Updated TTL");
        } else {
            logger.error(`Cannot update gateway ttl. status: ${response.data.status}, msg: ${response.data.msg}`);
        }
    } catch (err) {
        logger.error(`Cannot update gateway ttl. err: ${err}`);
    }
}

main();


