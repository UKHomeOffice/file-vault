language: node_js
node_js:
  - "6"

services:
  - docker

before_install:
  - docker build --tag travis .
  - docker run -d --net=host -e NODE_ENV=ci travis

script:
  - npm run test