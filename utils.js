"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFromTag = exports.directoryToFiles = exports.extractLayer = void 0;
const Bluebird = require("bluebird");
const klaw = require("klaw");
const extractLayer = (message) => {
    const extract = extractArrowMessage(message);
    if (extract !== undefined) {
        const shaRegex = /^([a-f0-9]{12}[a-f0-9]*)/g;
        const match = shaRegex.exec(extract);
        if (match) {
            return match[1];
        }
    }
    return;
};
exports.extractLayer = extractLayer;
const extractArrowMessage = (message) => {
    const arrowTest = /^\s*-+>\s*(.+)/;
    const match = arrowTest.exec(message);
    if (match) {
        return match[1];
    }
    else {
        return;
    }
};
const directoryToFiles = (dirPath) => {
    return new Bluebird((resolve, reject) => {
        const files = [];
        klaw(dirPath)
            .on('data', (item) => {
            if (!item.stats.isDirectory()) {
                files.push(item.path);
            }
        })
            .on('end', () => {
            resolve(files);
        })
            .on('error', reject);
    });
};
exports.directoryToFiles = directoryToFiles;
const fromTagPattern = /^(Step.+?\s*:\s*)?FROM\s+([\w-./]+)(:?([\w-./]+))?\s*(as\s+([\w-./]+))?/;
const extractFromTag = (message) => {
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
};
exports.extractFromTag = extractFromTag;
//# sourceMappingURL=utils.js.map