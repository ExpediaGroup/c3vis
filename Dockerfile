# https://hub.docker.com/r/library/node/

FROM node:9.11.1-alpine

# >> FIX:
# Fixes error Ubuntu: "gyp ERR! stack Error: Can't find Python executable "python", you can set the PYTHON env variable"
# REF: https://gist.github.com/vidhill/0a85dc1848feee4171944dc4d7757895
# REF: https://github.com/nodejs/node-gyp/issues/1105

# build base includes g++ and gcc and Make
RUN apk update && apk add python build-base

# << END FIX

# Bundle app source
COPY . /
RUN cd /; npm -d install

EXPOSE  3000
CMD ["npm", "start"]
