"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Bluebird = require("bluebird");
const Dockerode = require("dockerode");
const duplexify = require("duplexify");
const es = require("event-stream");
const JSONStream = require("JSONStream");
const _ = require("lodash");
const fs = require("mz/fs");
const path = require("path");
const tar = require("tar-stream");
const Utils = require("./utils");

class Builder {
    constructor() {
        this.docker = new Dockerode({
            Promise: Bluebird,
            socketPath: '/var/run/docker.sock'
        });
    }

    createBuildStream(buildOpts) {
        const inputStream = es.through();
        const dup = duplexify();
        dup.setWritable(inputStream);

        let streamError;
        const failBuild = _.once((err) => {
            streamError = err;
            dup.destroy(err);
            return null;
        });
        inputStream.on('error', failBuild);
        dup.on('error', failBuild);
        
        Bluebird.try(() => this.docker.buildImage(inputStream, buildOpts))
			.then((daemonStream) => {
				return new Bluebird((resolve, reject) => {
					const outputStream = getDockerDaemonBuildOutputParserStream(daemonStream, reject);
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

    buildDir(dirPath, buildOpts) {
        const pack = tar.pack();
        return Utils.directoryToFiles(dirPath)
            .map((file) => {
            const relPath = path.relative(path.resolve(dirPath), file);
            return Bluebird.all([relPath, fs.stat(file), fs.readFile(file)]);
        })
            .map((fileInfo) => {
            return Bluebird.fromCallback((callback) => pack.entry({ name: fileInfo[0], size: fileInfo[1].size }, fileInfo[2], callback));
        })
            .then(() => {
            pack.finalize();
            const stream = this.createBuildStream(buildOpts);
            pack.pipe(stream);
            return stream;
        });
    }
}

exports.default = Builder;
function getDockerDaemonBuildOutputParserStream(daemonStream, onError) {
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
                const fromTag = Utils.extractFromTag(data.stream);
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
