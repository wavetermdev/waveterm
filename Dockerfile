FROM ubuntu:latest
WORKDIR /app

RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get install -y golang-go nodejs npm && \
    npm install -g corepack && \
    corepack enable && \
    yarn install && \
    apt-get install -y libgtk2.0-0t64 libgtk-3-0t64 libgbm-dev libnotify-dev libnss3 libxss1 libasound2t64 libxtst6 xauth xvfb && \
    export DISPLAY=:0 && \
    service dbus start

RUN git clone https://github.com/scripthaus-dev/scripthaus.git
WORKDIR /app/scripthaus

RUN CGO_ENABLED=1 go build -o scripthaus cmd/main.go && \
    cp scripthaus /usr/local/bin

WORKDIR /app
RUN mkdir waveterm

WORKDIR /app/waveterm
COPY . .
RUN yarn cache clean
RUN yarn
RUN scripthaus run electron-rebuild
RUN scripthaus run build-backend
RUN scripthaus run webpack-watch

RUN useradd -m -s /bin/bash wave
USER wave

