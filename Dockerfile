FROM node:18.17.0-alpine3.18

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json .

RUN npm install
RUN npm install pm2 -g

# Copy app source
COPY . .

CMD [ "pm2-runtime", "start", "ecosystem.config.cjs" ]
