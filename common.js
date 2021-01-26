"use strict";

const fs = require('fs');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;
const path = require('path');


class Common {
    constructor() {
        let common = this;
        let settingsFile = require.resolve('./Settings.json');
        let settingsReloadCB = null;
        let loadSettings = () => {
            delete require.cache[settingsFile];
            common.settings = require(settingsFile);
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
                        if (err) {
                            if (err.stack) {
                                msg += " " + err.stack;
                            } else {
                                msg += " " + err;
                            }
                        }
                        intLogger.log({
                            level: 'error',
                            message: msg,
                            label: name
                        });
                    },
                    info: (text) => {
                        intLogger.log({
                            level: 'info',
                            message: text,
                            label: name
                        });
                    },
                    warn: (text) => {
                        intLogger.log({
                            level: 'warn',
                            message: text,
                            label: name
                        });
                    },
                    debug: (text) => {
                        intLogger.log({
                            level: 'debug',
                            message: text,
                            label: name
                        });
                    },
                    log: (...args) => {
                        let extra_meta = { label: name };
                        let len = args.length;
                        if (typeof args[len - 1] === 'object' && Object.prototype.toString.call(args[len - 2]) !== '[object RegExp]') {
                            _.extend(args[len - 1], extra_meta);
                        } else {
                            args.push(extra_meta);
                        }
                        intLogger.log.apply(Common.intLogger, args);
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