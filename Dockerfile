FROM quay.io/ukhomeofficedigital/nodejs-base:v6.9.1

RUN yum clean all && \
  yum update -y -q && \
  yum install -y -q git && \
  yum clean all && \
  rpm --rebuilddb

COPY package.json /app/package.json
RUN npm --loglevel warn install --production --no-optional
COPY . /app

CMD /app/run.sh