"use strict";
const Builder = require("./builder").default;

const builder = new Builder();
const hooks = {
    buildSuccess: (imageId, _layers) => {
        console.log(`Successful build! ImageId: ${imageId}`);
    },
    buildFailure: (error) => {
        console.error(`Error building container: ${error}`);
    }
};
builder
    .buildDir('test-files')
    .then((stream) => {
        if (stream) {
            stream.pipe(process.stdout);
        }
    });
