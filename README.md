We have found a regression with Dockerode v3.3.4 that only manifests itself when used from @balena/compose. This repository is to reproduce the error simply.

The error goes away when changing the dockerode version in `package.json` to "3.3.3".
