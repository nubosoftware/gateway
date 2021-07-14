"use strict";

const Common = require('./common.js');
const NetConn = require('./netConn');
const net = require('net');


function promiseConnect(options) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const connectHandler = () => {
            socket.removeListener("error", errorHandler);
            resolve(socket);
        };
        const errorHandler = (err) => {
            socket.removeListener("connect", connectHandler);
            reject(err)
        };
        socket.once("error", errorHandler);
        socket.connect(options, connectHandler);
    });
}


async function main() {
    let logger;
    try {
        await Common.init();
        logger = Common.logger(__filename);
        const socket = await promiseConnect({ port: 7090, host: "localhost" });

        const netConn = new NetConn(socket);

        for (let i = 0; i < 10; i++) {
            await netConn.writeInt(i);
        }
        await netConn.end();
        //await promiseSocket.once("drain");
        //await promiseSocket.destroy();

        logger.info("end");


    } catch (err) {
        if (logger) {
            logger.error("Error", err);
        } else {
            console.error(err);
        }
    }
}

main();