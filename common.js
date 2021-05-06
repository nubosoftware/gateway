"use strict";

const fs = require('fs');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;
const path = require('path');
const _ = require('underscore');

const defaultSettings = {
    "compressStream": "true",
    "trackURL": "https://nubosoftware.com/track/trackAPI",
    "platformControlPort": "8891",
    "platformPort": "8890",
    "playerPort": "0",
    "sslPlayerPort": "7443",
    "base_index": "1",
    "redisWrapperUrl": "http://127.0.0.1:8080",
    "backendAuthUser": "none",
    "backendAuthPassword": "none",
    "platformVersionCode": 290,
    "tlsOptions": {
        "keyfile": "../cert/server.key",
        "certfile": "../cert/server.cert",
        "cafile": "../cert/root.crt"
    }
};

class Common {
    constructor() {
        let common = this;
        let settingsFile = require.resolve('./Settings.json');
        let settingsReloadCB = null;
        let loadSettings = () => {
            delete require.cache[settingsFile];
            common.settings =  _.extend({},defaultSettings,require(settingsFile));
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
        }
        let initCB = null;
        let initPromise = new Promise((resolve, reject) => {
            initCB = {
                resolve: resolve,
                reject: reject
            };
            // do the actual initialization here

            // load settings for first time
            loadSettings();

            var loggerName = path.basename(process.argv[1], '.js') + ".log";
            var exceptionLoggerName = path.basename(process.argv[1], '.js') + "_exceptions.log";

            // init logger
            const myFormat = printf(info => {
                return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
            });
            require('winston-syslog').Syslog;
            const intLogger = createLogger({
                format: combine(
                    timestamp(),
                    myFormat
                ),
                transports: [
                    new(transports.Console)({
                        name: 'console',
                        json: true,
                        handleExceptions: true,
                        timestamp: true,
                        colorize: true
                    }),
                    new transports.File({
                        name: 'file',
                        filename: __dirname + '/log/' + loggerName,
                        handleExceptions: true,
                        maxsize: 100 * 1024 * 1024, //100MB
                        maxFiles: 4,
                    }),
                    new transports.Syslog({
                        app_name : "nubogateway",
                        handleExceptions : true,
                        localhost: null,
                        protocol: "unix",
                        path: "/dev/log",
                        format: format.json()
                    })
                ],
                exceptionHandlers: [
                    new(transports.Console)({
                        json: false,
                        timestamp: true
                    }),
                    new transports.File({
                        filename: __dirname + '/log/' + exceptionLoggerName,
                        json: false
                    })
                ],
                exitOnError: false
            });

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
                        intLogger.log(res);
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
                        intLogger.log(res);
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
                        intLogger.log(res);
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
                        intLogger.log(res);
                    },
                    log: (obj) => {
                        if(!obj.label) obj.label = name;
                        intLogger.log(obj);
                    }
                };

                return moduleLogger;
            };

            let commonLogger = common.logger(__filename);

            // watch settings file
            fs.watchFile(settingsFile, { persistent: false, interval: 5007 }, function(curr, prev) {
                commonLogger.info('Settings.json. the current mtime is: ' + curr.mtime);
                commonLogger.info('Settings.json. the previous mtime was: ' + prev.mtime);
                loadSettings();
            });


            commonLogger.info("Initialized");

            initCB.resolve(true);


        });

        this.init = function() {
            return initPromise;
        };
        //
    }
}

let common = new Common();

module.exports = common;
