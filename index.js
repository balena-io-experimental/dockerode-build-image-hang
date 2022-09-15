"use strict";
const Builder = require("./builder").default;
const builder = Builder.fromDockerOpts({ socketPath: '/var/run/docker.sock' });
const hooks = {
    buildSuccess: (imageId, _layers) => {
        console.log(`Successful build! ImageId: ${imageId}`);
    },
    buildFailure: (error) => {
        console.error(`Error building container: ${error}`);
    }
};
builder
    .buildDir('test-files', {}, hooks)
    .then((stream) => {
    stream.pipe(process.stdout);
});
