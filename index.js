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

/**
 * Start a build with the docker daemon, and return the stream to the caller.
 * The stream can be written to, and the docker daemon will interpret that
 * as a tar archive to build. The stream can also be read from, and the data
 * returned will be the output of the docker daemon build.
 *
 * @returns A bi-directional stream connected to the docker daemon
 */
function createBuildStream() {
    // As data is written to inputStream, it will become readable synchronously
    // in the same stream for buildImage().
    // https://github.com/dominictarr/event-stream#through-write-end
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

/**
 * Return an event stream capable of parsing a docker daemon's JSON object output.
 * 
 * @param daemonStream: Docker daemon's output stream (dockerode.buildImage)
 * @param onError Error callback
 */
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

function extractFromTag(message) {
    const fromTagPattern = /^(Step.+?\s*:\s*)?FROM\s+([\w-./]+)(:?([\w-./]+))?\s*(as\s+([\w-./]+))?/;
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


// Build tar stream from Dockerfile. Created sync here, but usually async.
const pack = tar.pack();
const pathName = 'Dockerfile';
pack.entry(
    { name: pathName, size: fs.statSync(pathName).size }, fs.readFileSync(pathName));
pack.finalize();

// Create stream to pipe tar data to Docker to build image and print output
const stream = createBuildStream();

// Let's go!
pack.pipe(stream);
// Display docker stream output
stream.pipe(process.stdout);
