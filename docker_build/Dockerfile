FROM ubuntu:20.04 as builder
ARG BUILD_VER=3.2
ENV DEBIAN_FRONTEND noninteractive
RUN sed -i "s/# deb-src/deb-src/g" /etc/apt/sources.list
RUN apt-get -y update
RUN apt-get -yy upgrade


#
# Base directory for installed build artifacts.
#
# NOTE: Due to limitations of the Docker image build process, this value is
# duplicated in an ARG in the second stage of the build.
#
ARG PREFIX_DIR=/usr/local/guacamole

# Build arguments
ARG BUILD_DIR=/tmp/guacd-docker-BUILD
ARG BUILD_DEPENDENCIES="              \
        autoconf                      \
        automake                      \
        freerdp2-dev                  \
        gcc                           \
        git                           \
        libcairo2-dev                 \
        libgcrypt-dev                 \
        libjpeg-dev           \
        libossp-uuid-dev              \
        libpango1.0-dev               \
        libpulse-dev                  \
        libssh2-1-dev                 \
        libssl-dev                    \
        libtelnet-dev                 \
        libtool                       \
        libvncserver-dev              \
        libwebsockets-dev             \
        libwebp-dev                   \
        make"



# ENV BUILD_DEPS="git autoconf pkg-config libssl-dev libpam0g-dev \
#     libx11-dev libxfixes-dev libxrandr-dev nasm xsltproc flex \
#     bison libxml2-dev dpkg-dev libcap-dev wget"
RUN apt-get -yy install  sudo apt-utils software-properties-common $BUILD_DEPENDENCIES

# checkout guacamole server report
RUN mkdir "${BUILD_DIR}" && \
    git clone -b 1.4.0 https://github.com/apache/guacamole-server.git ${BUILD_DIR}

# Add configuration scripts
RUN mkdir -p "${PREFIX_DIR}/bin/" && \
    cp -a ${BUILD_DIR}/src/guacd-docker/bin/* "${PREFIX_DIR}/bin/."
#COPY guacamole-server/src/guacd-docker/bin "${PREFIX_DIR}/bin/"

# Copy source to container for sake of build
#COPY guacamole-server "$BUILD_DIR"

# Build guacamole-server from local source
RUN ${PREFIX_DIR}/bin/build-guacd.sh "$BUILD_DIR" "$PREFIX_DIR"

# Record the packages of all runtime library dependencies
RUN ${PREFIX_DIR}/bin/list-dependencies.sh     \
        ${PREFIX_DIR}/sbin/guacd               \
        ${PREFIX_DIR}/lib/libguac-client-*.so  \
        ${PREFIX_DIR}/lib/freerdp2/*guac*.so   \
        > ${PREFIX_DIR}/DEPENDENCIES


FROM ubuntu:20.04
ARG BUILD_VER=3.2
ARG TARGET_DIR=/opt/nubogateway
RUN apt-get -y update
# install linux packages
RUN apt install -y \
    curl \
    supervisor \
    rsyslog \
    vim \
    iputils-ping \
    telnet \
    dnsutils \
    net-tools \
    sudo

#
# Base directory for installed build artifacts. See also the
# CMD directive at the end of this build stage.
#
# NOTE: Due to limitations of the Docker image build process, this value is
# duplicated in an ARG in the first stage of the build.
#
ARG PREFIX_DIR=/usr/local/guacamole

# Runtime environment
ENV LC_ALL=C.UTF-8
ENV LD_LIBRARY_PATH=${PREFIX_DIR}/lib
ENV GUACD_LOG_LEVEL=info

# Copy build artifacts into this stage
COPY --from=builder ${PREFIX_DIR} ${PREFIX_DIR}

# Install guacd dependencies
RUN apt install -y netcat-openbsd     \
        ca-certificates               \
        ghostscript                   \
        fonts-liberation              \
        fonts-dejavu                  \
        libcairo2                     \
        libssh2-1                     \
        libfreerdp-client2-2          \
        xfonts-terminus

RUN apt install -y $(cat "${PREFIX_DIR}"/DEPENDENCIES)

# Link FreeRDP plugins into proper path
ENV FREERDP_PLUGIN_DIR=/usr/lib/x86_64-linux-gnu/freerdp2
RUN mkdir -p $FREERDP_PLUGIN_DIR && \
        ln -s "${PREFIX_DIR}/lib/freerdp2/libguac-common-svc-client.so" "$FREERDP_PLUGIN_DIR" && \
        ln -s "${PREFIX_DIR}/lib/freerdp2/libguacai-client.so" "$FREERDP_PLUGIN_DIR"



# install nodejs
RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
RUN apt install -y nodejs

# mark this as docker installation
RUN mkdir -p /etc/.nubo/ && \
    touch  /etc/.nubo/.docker

# configure
ADD docker_build/etc /etc
ADD docker_build/bin /usr/bin
RUN sed -i /imklog/s/module/#module/ /etc/rsyslog.conf

# copy files to target dir
RUN mkdir -p ${TARGET_DIR}
COPY package.json ${TARGET_DIR}/.
COPY webpack.config.js ${TARGET_DIR}/.
ADD src ${TARGET_DIR}/src
WORKDIR ${TARGET_DIR}
RUN echo "VERSION: ${BUILD_VER}" > version.txt

# add build essential
RUN apt install -y build-essential

# prepare the module
RUN npm install

# remove build-essntial
RUN apt-get --purge autoremove -y build-essential

# build the dist folder
RUN npm run build

# remove build dependencies
RUN rm -rf src webpack.config.js

# Create a new user nubo
ARG UID=1000
ARG GID=1000
RUN groupadd --gid $GID nubo
RUN useradd --system --create-home --shell /usr/sbin/nologin --uid $UID --gid $GID nubo

RUN chown -R nubo:nubo ${TARGET_DIR} && \
        mkdir -p /var/run/supervisor && \
        chown -R nubo:nubo /var/run/supervisor && \
        mkdir -p /var/log/supervisor && \
        chown -R nubo:nubo /var/log/supervisor

# Run with user nubo
# USER nubo

# Docker config
VOLUME ["${TARGET_DIR}/conf"]
EXPOSE 4822
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["supervisord"]
