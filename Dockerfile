# https://hub.docker.com/r/library/node/

FROM node:8.5-slim

# Bundle app source
COPY . /
RUN cd /; npm -d install

EXPOSE  3000
CMD ["npm", "start"]
