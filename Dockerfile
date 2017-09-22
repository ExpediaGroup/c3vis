# https://hub.docker.com/r/library/node/

FROM node:8.2-alpine

# Bundle app source
COPY . /
RUN cd /; npm -d install

EXPOSE  3000
CMD ["npm", "start"]
