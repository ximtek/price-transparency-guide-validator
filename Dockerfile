# Build C++ Validator
FROM ubuntu as build
ARG VERSION=v1.0.0

RUN apt-get update && apt-get install -y g++ cmake doxygen valgrind wget
COPY ./schemavalidator.cpp /
COPY ./rapidjson/ /rapidjson/
COPY ./tclap/ /tclap/

# RUN ls -R /rapidjson && ls -R /tclap && sleep 10
RUN g++ -O3 --std=c++17 -I /rapidjson/include -I /tclap/include/ schemavalidator.cpp -o validator -lstdc++fs

# Build Node.js Server
FROM node:18 as node-build
WORKDIR /app

# Copy essential files first (to leverage Docker layer caching)
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/

# Install dependencies and compile TypeScript
RUN npm install
RUN npm run build

# Final Container with Both C++ Validator & Node.js Server
FROM node:18 as final
WORKDIR /app

# Copy compiled C++ binary
COPY --from=build /validator /validator

# Copy the built Node.js app
COPY --from=node-build /app /app

EXPOSE 3000
CMD ["node", "out/server.js"]
