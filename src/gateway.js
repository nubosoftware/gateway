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
        }
        Common.settingsReload.then(reloadSettings);
        await loadSecureContext();

        if (Common.settings.platformControlPort) {
            let platformControlService = new NetService(Common.settings.platformControlPort , PlatControl);
            await platformControlService.listen();
        }

        if (Common.settings.platformPort) {
            let platformConnService = new NetService(Common.settings.platformPort, PlatConn);
            await platformConnService.listen();
        }

        if (Common.settings.playerPort && Common.settings.playerPort > 0) {
            let playerService = new NetService(Common.settings.playerPort, PlayerConn);
            await playerService.listen();
            await registerGateway(playerService, false);
        } else if (Common.settings.sslPlayerPort && Common.settings.sslPlayerPort > 0) {
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

        if (Common.settings.platformRTPPort) {
            let platformRTPService = new PlatformRTPService(Common.settings.platformRTPPort);
        }

        if (Common.settings.PlayerRTPPort) {
            let playerRTPSocket = new PlayerRTPSocket(Common.settings.PlayerRTPPort);
        }

        logger.info("Gateway loaded!", {mtype: "important"});

    } catch (err) {
        if (logger) {
            logger.error("Error", err);
        } else {
            console.error(err);
        }
    }
}

let registeredGWs = 0;
let updateGWInterval;

async function registerGateway(service, isSsl) {
    const data = Common.settings;
    let isSuccess = false;
    while (!isSuccess) {
        try {
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
                isSuccess = true;
                logger.info(`Gateway registered. Gateway ID: ${gwIdx}`)
                updateGWInterval = setInterval(() => {
                    updateGWTTL(gwIdx,service,isSsl);
                }, 5000);
                return gwIdx;
            } else {
                logger.error(`Cannot register gateway. status: ${response.data.status}, msg: ${response.data.msg}`);
                //return GWStatusCode.errIllegalRedisData;
            }
        } catch(err) {
            logger.info(`Cannot register gateway. Error: ${err}`);
        }
        await sleep(5000);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateGWTTL(idx,service,isSsl) {
    const data = Common.settings;
    let isSuccess = false;
    const url = "/redisGateway/updateGatewayTtl?idx=" + idx + "&ttl=240&internal_ip=" +
        data.internal_ip;
    try {
        let response = await mgmtCall.get({
            url,
        });

        if (response.data.status == GWStatusCode.OK) {
            //logger.info("Updated TTL");
            isSuccess = true;
        } else {
            logger.error(`Cannot update gateway ttl. status: ${response.data.status}, msg: ${response.data.msg}`);
        }
    } catch (err) {
        logger.error(`Cannot update gateway ttl. err: ${err}`);
    }
    if (!isSuccess) {
        clearInterval(updateGWInterval);
        setTimeout(() => {
            logger.info(`Try to re-register gateway`);
            registerGateway(service,isSsl);
        }, 5000);

    }
}

main();


