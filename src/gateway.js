"use strict";

const Common = require('./common.js');
// const NetService = require('./netService');
const { NetService, NetConn } = require('node-tcp');
let secureCtx;
const PlayerConn = require('./playerConn');
const PlatControl = require('./platControl');
const PlatConn = require('./platConn');
// const RDPConn = require('./rdpConn');
const { PlatformRTPService } = require('./platformRTPService');
const { PlayerRTPSocket } = require('./playerRTPSocket');
const mgmtCall = require('./mgmtCall');
const tls = require('tls');
const process = require('process');
const guac = require('./guac');

const {
    PlayerCmd,
    PlatformCtrlCmd,
    PlatformCtrlCmdSize,
    GWStatusCode,
    DrawCmd,
} = require('./constants');

let logger;


async function loadSecureContext() {
    const readFile = require('fs').promises.readFile;
    if (Common.settings.tlsOptions) {
        try {
            Common.settings.tlsOptions.key = await readFile(Common.settings.tlsOptions.keyfile);
            Common.settings.tlsOptions.cert = await readFile(Common.settings.tlsOptions.certfile);
            if (Common.settings.tlsOptions.cafile) {
                logger.info("Loading cafile..");
                Common.settings.tlsOptions.ca = await readFile(Common.settings.tlsOptions.cafile);
            }
            secureCtx = tls.createSecureContext(Common.settings.tlsOptions);
            watchCertFile();
        } catch (err) {
            logger.error(`Unable to create TLS context: ${err}`,err);
        }
    }
}

async function watchCertFile() {
    const watch = require('fs').promises.watch;
    try {
        const watcher = watch(Common.settings.tlsOptions.certfile);
        for await (const event of watcher) {
            logger.info(`Certification file changed: ${JSON.stringify(event)}`);
            loadSecureContext()
        }
    } catch (err) {
        logger.info(`Error in watchCertFile: ${err}`,err);
    }
}

function attachUnregisterOnExit(idx) {
    var updateGWTTL = async function() {
        const url = "/redisGateway/unregisterGateway?idx=" + idx;
        try {
            let response = await mgmtCall.get({
                url,
            });
            if (response.data.status == GWStatusCode.OK) {
                logger.info("Gateway " + idx + " unregistered");
            } else {
                logger.error(`Cannot unregister gateway. status: ${response.data.status}, msg: ${response.data.msg}`);
            }
        } catch (err) {
            logger.error(`Cannot unregister gateway. err: ${err}`);
        }
    }

    Common.exitJobs.push(updateGWTTL);
}

async function main() {

    try {

        await Common.init();
        logger = Common.logger(__filename);
        logger.info("Start gateway", {mtype: "important"});

        // setup exception handler
        process.on('uncaughtException', (err, origin) => {
            console.error(`gateway.js. uncaughtException: ${err.message}, Stack: ${err.stack}, origin: ${origin}`);
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
        let tlsOptions = {
            SNICallback: (servername, cb) => {
                logger.info(`SNICallback. servername: ${servername}`)
                cb(null, secureCtx);
            }
        };
        Common.tlsOptions = tlsOptions;

        if (Common.settings.platformControlPort) {
            let platformControlService = new NetService(Common.settings.platformControlPort , PlatControl);
            await platformControlService.listen();
        }

        if (Common.settings.platformPort) {
            let platformConnService = new NetService(Common.settings.platformPort, PlatConn);
            await platformConnService.listen();
        }

        // if (Common.settings.rdpPort) {

        //     // tempory create "test" session
        //     const { getSession } = require('./session');
        //     const session = getSession("test");
        //     await session.createRdpSession();

        //     let rdpTlsOptions = (Common.settings.rdpTLS ? tlsOptions : null);
        //     let rdpConnService = new NetService(Common.settings.rdpPort, RDPConn,rdpTlsOptions,null);
        //     await rdpConnService.listen();
        // }

        let gwIdx;
        if (Common.settings.playerPort && Common.settings.playerPort > 0) {
            let playerService = new NetService(Common.settings.playerPort, PlayerConn);
            await playerService.listen();
            gwIdx = await registerGateway(playerService, false);
        } else if (Common.settings.sslPlayerPort && Common.settings.sslPlayerPort > 0) {
            let playerService = new NetService(Common.settings.sslPlayerPort, PlayerConn, tlsOptions);
            await playerService.listen();
            gwIdx = await registerGateway(playerService, true);
        } else if (Common.settings.guacPort && Common.settings.guacPort > 0) {
            logger.info(`Guacd listen on port ${Common.settings.guacPort}`);
            guac.startGuacd(Common.settings.guacPort);
            gwIdx = await registerGateway({port: Common.settings.guacPort}, false);
        } else {
            throw new Error("Not found any client service to listen.");
        }

        if (Common.settings.platformRTPPort) {
            let platformRTPService = new PlatformRTPService(Common.settings.platformRTPPort);
        }

        if (Common.settings.playerRTPPort) {
            let playerRTPSocket = new PlayerRTPSocket(Common.settings.playerRTPPort);
        }

        attachUnregisterOnExit(gwIdx);

        process.on('SIGINT', function() {
            logger.info("Gateway caught SIGINT signal");
            Common.quit();
        });
        process.on('SIGTERM', function() {
            logger.info("Gateway caught SIGTERM signal");
            Common.quit();
        });

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
            let internal_ip,external_ip,port,ssl;
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
            internal_ip = data.internal_ip;
            if (!internal_ip || internal_ip == "auto") {
                internal_ip = await detectIP();
            }
            let url = "/redisGateway/registerGateway?baseIndex=" + data.base_index + "&offset=" + registeredGWs;
            url = url + "&internal_ip=" + internal_ip;
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

/**
 * Detect the local IP address
 * Try to send request to management and get the localAddress from the socker
 * @returns IP address
 */
 async function detectIP() {
    const url = "/redisGateway/updateGatewayTtl?idx=999&ttl=240&internal_ip=none";
    let response = await mgmtCall.get({
        url,
    });
    const ip = response.request.socket.localAddress;
    logger.info(`Detected local ip address: ${ip} `);
    return ip;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateGWTTL(idx,service,isSsl) {
    const data = Common.settings;
    let isSuccess = false;
    const url = "/redisGateway/updateGatewayTtl?idx=" + idx + "&ttl=" + data.gatewayTTL + "&internal_ip=" +
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


