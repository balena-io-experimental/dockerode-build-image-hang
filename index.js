"use strict";
const Bluebird = require("bluebird");
const Dockerode = require("dockerode");
const duplexify = require("duplexify");
const es = require("event-stream");
const fs = require("mz/fs");
const JSONStream = require("JSONStream");
const _ = require("lodash");
const tar = require("tar-stream");

const docker = new Dockerode({
    Promise: Bluebird,
    socketPath: '/var/run/docker.sock'
});

function createBuildStream() {
    const inputStream = es.through();
    const dup = duplexify();
    dup.setWritable(inputStream);

    let streamError;
    const failBuild = _.once((err) => {
        streamError = err;
        dup.destroy(err);
        console.log(`build failed: ${err}`);
        return null;
    });
    inputStream.on('error', failBuild);
    dup.on('error', failBuild);
    
    Bluebird.try(() => docker.buildImage(inputStream, {}))
        .then((daemonStream) => {
            return new Bluebird((resolve, reject) => {
                const outputStream = getBuildOutputStream(daemonStream, reject);
                outputStream.on('error', (error) => {
                    daemonStream.unpipe();
                    reject(error);
                });
                outputStream.on('end', () => streamError ? reject(streamError) : resolve());
                dup.setReadable(outputStream);
            });
        })
        .catch(failBuild);

    return dup;
}

function getBuildOutputStream(daemonStream, onError) {
    const fromAliases = new Set();
    return (daemonStream
        .pipe(JSONStream.parse())
        .pipe(es.through(function (data) {
        if (data == null) {
            return;
        }
        try {
            if (data.error) {
                throw new Error(data.error);
            }
            else {
                const fromTag = extractFromTag(data.stream);
                if (fromTag !== undefined) {
                    if (fromTag.alias) {
                        fromAliases.add(fromTag.alias);
                    }
                }
                this.emit('data', data.stream);
            }
        }
        catch (error) {
            daemonStream.unpipe();
            onError(error);
        }
    })));
}

const fromTagPattern = /^(Step.+?\s*:\s*)?FROM\s+([\w-./]+)(:?([\w-./]+))?\s*(as\s+([\w-./]+))?/;
function extractFromTag(message) {
    const match = fromTagPattern.exec(message);
    if (!match) {
        return undefined;
    }
    const res = {
        repo: match[2],
        tag: match[4] || 'latest',
    };
    if (match[6]) {
        res.alias = match[6];
    }
    return res;
}


const pack = tar.pack();
const pathName = 'Dockerfile';
pack.entry(
    { name: pathName, size: fs.statSync(pathName).size }, fs.readFileSync(pathName));
pack.finalize();
const stream = createBuildStream();
pack.pipe(stream);
stream.pipe(process.stdout);
