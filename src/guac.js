"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const spawn = require('child_process').spawn;


/**
 * the guacd ChildProcess 
 */
var guacdProcess = null;

/**
 * Start guacd daemon with the given port number
 * @param {Number} port 
 */
function startGuacd(port) {
    ///usr/local/guacamole/sbin/guacd -b 0.0.0.0 -L info
    try {
        const portStr = "" + port;
        var child = spawn("/usr/local/guacamole/sbin/guacd", ["-b", "0.0.0.0", "-l", portStr, "-L", "info"]);
        logger.info(`guacd. Started guacd on port: ${portStr}, pid: ${child.pid}`);
        child.stdout.on('data', (data) => {
            logger.info(`guacd stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            logger.info(`guacd stderr: ${data}`);
        });

        child.on('close', (code) => {
            logger.info(`guacd child process exited with code ${code}`);
            guacdProcess = null;
        });
        child.on('error', (err) => {
            logger.error(`guacd child process error: ${err}`,err);
        });
        guacdProcess = child;
        Common.exitJobs.push(exit);
    } catch (err) {
        logger.error(`Unable to start guacd: ${err}`,err);
    }
}

async function exit() {
    if (guacdProcess) {
        logger.info(`Sending SIGTERM to guacd (pid: ${guacdProcess.pid})`);
        guacdProcess.kill();
    }
}

module.exports = {
    startGuacd,
    exit
}