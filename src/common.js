"use strict";

const fs = require('fs');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;
const path = require('path');
const _ = require('underscore');
var fsp = require('fs').promises;
const os = require('os');



const defaultSettings = {
    "compressStream": "true",
    "trackURL": "https://nubosoftware.com/track/trackAPI",
    "platformControlPort": "8891",
    "platformPort": "8890",
    "playerPort": "0",
    "sslPlayerPort": "7443",
    "platformRTPPort": "60005",
    "playerRTPPort": "50005",
    "guacPort":false,
    "base_index": "1",
    "redisWrapperUrl": "http://127.0.0.1:8080",
    "backendAuthUser": "none",
    "backendAuthPassword": "none",
    "platformVersionCode": 290,
    "tlsOptions": {
        "keyfile": "../cert/server.key",
        "certfile": "../cert/server.cert"
    }
};


const DOCKERKEY = '/etc/.nubo/.docker';

async function fileExists(filepath) {
    try {
        await fsp.access(filepath);
        return true;
    } catch (e) {
        return false;
    }
}

async function fileMoveIfNedded(newFilePath,oldFilePath) {
    let exists = await fileExists(newFilePath);
    if (exists) {
        return;
    }
    let oldExists = await fileExists(oldFilePath);
    if (oldExists) {
        console.log(`Moving file ${oldFilePath} to new location at: ${newFilePath}`);
        let dir = path.dirname(newFilePath);
        await fsp.mkdir(dir,{recursive: true});
        await fsp.copyFile(oldFilePath,newFilePath);
        await fsp.unlink(oldFilePath);
        return;
    } else {
        throw new Error(`File not found in both old location: ${oldFilePath} and new location: ${newFilePath}`);
    }
}







class Common {

    async checkDockerConf() {
        let common = this;
        if (!common._isDockerChecked) {
            let isDocker = await fileExists(DOCKERKEY);
            let settingsFileName;
            console.log(`common.rootDir: ${common.rootDir}`);
            if (isDocker) {
                console.log("Runnig in a docker container");
                common.isDocker = true;
                settingsFileName = path.join(common.rootDir,'conf','Settings.json');
                // move file if needed
                const oldfileLocation = path.join(common.rootDir,'Settings.json');
                await fileMoveIfNedded(settingsFileName,oldfileLocation);
            } else {
                common.isDocker = false;
                settingsFileName = path.join(common.rootDir,'Settings.json');
            }
            common._isDockerChecked = true;
            common.settingsFileName = settingsFileName;
        }
    }

    loadSettings() {
        let common = this;
        return new Promise((resolve, reject) => {
            common.checkDockerConf().then(() => {
                return fsp.readFile(common.settingsFileName,"utf8");
            }).then(data => {
                let rawSettings = data.toString().replace(/[\n|\t]/g, '');
                let settings = JSON.parse(rawSettings);
                common.settings =  _.extend({},defaultSettings,settings);
                console.log("Settings: "+JSON.stringify(common.settings,null,2));
                resolve();
            })
            .catch(err => {
                console.error(err);
                reject(err);
            });
        });
    }



    constructor() {
        let common = this;
        common.rootDir = process.cwd();
        //let settingsFile = path.resolve('./Settings.json');
        //console.log(`settingsFile: ${settingsFile}`);
        //let settingsFile = require.resolve('./Settings.json');


        // initialize promise that will call every time a setting reload
        let settingsReloadCB = null;
        common.settingsReload = new Promise((resolve, reject) => {
            settingsReloadCB = {
                resolve: resolve,
                reject: reject
            };
        });
        /*(let loadSettings = () => {
            try {
                let data = fs.readFileSync('Settings.json','utf8');
                let rawSettings = data.toString().replace(/[\n|\t]/g, '');
                let settings = JSON.parse(rawSettings);
                common.settings =  _.extend({},defaultSettings,settings);
                console.log("Settings: "+JSON.stringify(common.settings,null,2));
                let saveCB = settingsReloadCB;
                common.settingsReload = new Promise((resolve, reject) => {
                    settingsReloadCB = {
                        resolve: resolve,
                        reject: reject
                    };
                });
                if (saveCB) {
                    saveCB.resolve(true);
                }
            } catch (err) {
                saveCB.reject(err);
            }

        }*/

        // initiaze a promise that will after the first init
        let initCB = null;
        let initPromise = new Promise((resolve, reject) => {
            initCB = {
                resolve: resolve,
                reject: reject
            };
            // do the actual initialization here

            common.createIntLogger = function() {
                var loggerName = path.basename(process.argv[1], '.js') + ".log";
                    var exceptionLoggerName = path.basename(process.argv[1], '.js') + "_exceptions.log";

                    // init logger
                    const myFormat = printf(info => {
                        return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
                        //return info.timestamp + /*' ['+info.label+'] '+*/info.level+': '+info.message;
                    });


                    let ourtransports = [
                        new(transports.Console)({
                            name: 'console',
                            json: true,
                            handleExceptions: false,
                            timestamp: true,
                            colorize: true
                        }),
                        new transports.File({
                            name: 'file',
                            filename: common.rootDir + '/log/' + loggerName,
                            handleExceptions: false,
                            maxsize: 100 * 1024 * 1024, //100MB
                            maxFiles: 4,
                        })];
                    let syslogParams = {
                        app_name : "nubogateway",
                        handleExceptions : false,
                        localhost: os.hostname(),
                        type: "RFC5424",
                        //protocol: "unix",
                        //path: "/dev/log",
                        protocol: 'udp',
                        host: 'nubo-rsyslog',
                        port: 5514,
                        format: format.json()
                    };
                    if (common.settings && common.settings.syslogParams) {
                        _.extend(syslogParams,common.settings.syslogParams);
                    } else {
                        syslogParams.disable = true;
                    }
                    if (!syslogParams.disable) {
                        let Syslog = require('@nubosoftware/winston-syslog').Syslog;
                        let syslogTransport = new Syslog(syslogParams);
                        syslogTransport.on('error',err => {
                            console.error(`Syslog error`,err);
                            return true;
                        });
                        ourtransports.push(syslogTransport);
                    }

                    common.intLogger = createLogger({
                        format: combine(
                            timestamp(),
                            myFormat
                        ),
                        transports: ourtransports,
                    });
                    common.intLoggerError = (err) => {
                        console.log(`Log callback. err: ${err}`);
                    }
            }

            common.createIntLogger();



            common.logger = (fileName) => {
                let name = path.basename(fileName);
                let moduleLogger = {
                    error: (text, err) => {
                        let msg = text;
                        let res = {
                            level: 'error',
                            label: name
                        }
                        if (err) {
                            if (typeof err === "object") {
                                if (err instanceof Error) {
                                    msg += " " + err.stack;
                                } else {
                                    res = Object.assign(obj, res);
                                }
                            } else {
                                msg += " " + err;
                            }
                        }
                        res.message = msg;
                        common.intLogger.log(res);
                    },
                    info: (text, obj) => {
                        let res = {
                            level: 'info',
                            message: text,
                            label: name
                        }
                        if(typeof obj === "object") {
                            res = Object.assign(obj, res);
                        }
                        common.intLogger.log(res);
                    },
                    warn: (text, obj) => {
                        let res = {
                            level: 'warn',
                            message: text,
                            label: name
                        }
                        if(typeof obj === "object") {
                            res = Object.assign(obj, res);
                        }
                        common.intLogger.log(res);
                    },
                    debug: (text, obj) => {
                        let res = {
                            level: 'debug',
                            message: text,
                            label: name
                        }
                        if(typeof obj === "object") {
                            res = Object.assign(obj, res);
                        }
                        common.intLogger.log(res);
                    },
                    log: (obj) => {
                        if(!obj.label) obj.label = name;
                        common.intLogger.log(res);
                    }
                };

                return moduleLogger;
            };

            let commonLogger = common.logger(__filename);

            // load settings for first time
            common.loadSettings().then(() => {
                if (common.settings.syslogParams) {
                    console.log('Re-create logger..');
                    common.createIntLogger();
                }
                // watch settings file
                fs.watchFile(common.settingsFileName, { persistent: false, interval: 5007 }, function(curr, prev) {
                    commonLogger.info('Settings.json. the current mtime is: ' + curr.mtime);
                    commonLogger.info('Settings.json. the previous mtime was: ' + prev.mtime);
                    common.loadSettings().then(() => {
                        settingsReloadCB.resolve();
                    }).catch(err => {
                        commonLogger.error(`Error while load settings: ${err}`);
                    });
                });
                commonLogger.info("Initialized");
                initCB.resolve(true);
            }).catch(err => {
                commonLogger.error(`Fatal error while load setting: ${err}`,err);
                process.exit(1);
            });


            common.exitJobs = [];

            common.quit = async function() {
                commonLogger.info(`quit. Running ${common.exitJobs.length} exit jobs..`);
                for (const job of common.exitJobs) {
                    try {
                        await job();
                    } catch (e) {
                        commonLogger.error(`Exit job error: ${e}`,e);
                    }
                }
                commonLogger.info(`quit. Exit`);
                process.exit(0);
            };
        });

        this.init = function() {
            return initPromise;
        };
        //
    }
}

let common = new Common();



module.exports = common;
