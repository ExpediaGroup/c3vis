# https://hub.docker.com/r/library/node/

FROM node:4.1

# Bundle app source
COPY . /
RUN cd /; npm -d install

EXPOSE  3000
CMD ["npm", "start"]
