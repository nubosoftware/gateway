# Gateway Service
## Remote Display Protocol Gateway

It is part of the [Linux Remote Desktop](https://github.com/nubosoftware/linux-remote-desktop) system.

Runs Guacamole proxy that converts traffic from Gucamole web clients to RDP.

Mutiple services can be added for performance. The services independently register themselves on the management service, so it can send traffic through them.

## Build Instructions
```
git clone git@github.com:nubosoftware/gateway.git
cd gateway
npm install --only=dev
cd docker_build
git clone git@github.com:apache/guacamole-server.git
cd ..
make docker
```
