"use strict";

const Common = require('./common.js');
const logger = Common.logger(__filename);
const axios = require('axios');

const mgmtCall = {


    req: (options) => {

        options.url = Common.settings.redisWrapperUrl + options.url;

        if (!options.method) {
            options.method = "get";
        }
        if (!options.headers) {
            options.headers = {};
        }

        options.headers['fe-user'] = Common.settings.backendAuthUser;
        options.headers['fe-pass'] = Common.settings.backendAuthPassword;
        //logger.info(`axios: ${JSON.stringify(options,null,2)}`);
        return axios(options);
    },
    post: (options) => {
        options.method = "post";
        return mgmtCall.req(options);
    },
    get: (options) => {
        options.method = "get";
        return mgmtCall.req(options);
    },
    put: (options) => {
        options.method = "put";
        return mgmtCall.req(options);
    },
    delete: (options) => {
        options.method = "delete";
        return mgmtCall.req(options);
    }
}

module.exports = mgmtCall;