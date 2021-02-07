"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);

class BWStats {
    constructor(tag) {
        this.TAG = tag
        this.totalOutBytes = 0;
        this.intervalOutBytes = 0;
        this.totalInBytes = 0;
        this.intervalInBytes = 0;
        this.startTime = new Date().getTime();
        this.outRates = [];
        this.inRates = [];
        this.totalSeconds = 0;
        this.timer = setInterval(() => {
            this.calcauteInterval();
        }, 1000);
    }

    log(msg) {
        logger.info(`${this.TAG}: ${msg}`);
    }

    calcauteInterval() {
        const rateOut = Math.trunc((this.intervalOutBytes * 8) / 1000);
        this.outRates.push(rateOut);
        this.intervalOutBytes = 0;

        const rateIn = Math.trunc((this.intervalInBytes * 8) / 1000);
        this.inRates.push(rateIn);
        this.intervalInBytes = 0;

        this.log("rateOut: " + rateOut + ", rateIn: " + rateIn);

        this.totalSeconds++;

    }

    stop() {
        clearInterval(this.timer);
        this.log(`Connection stats:\n Total time: ${this.totalSeconds} seconds.\n Average Out: ${average(this.outRates)} kbps.\n Average In:  ${average(this.inRates)} kbps.\n Max Out ${max(this.outRates)} kbps.\n Max In ${max(this.inRates)} kbps.\n`);
    }

    addOutBytes(b) {
        this.totalOutBytes += b;
        this.intervalOutBytes += b;
    }

    addInBytes(b) {
        this.totalInBytes += b;
        this.intervalInBytes += b;
    }
}

const average = (array) => (array.reduce((a, b) => a + b) / array.length).toFixed(2);
const max = (array) => array.reduce((a, b) => (a > b ? a : b));

module.exports = { BWStats };