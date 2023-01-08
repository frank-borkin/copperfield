FROM node:16-bullseye-slim AS build
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm install

FROM gcr.io/distroless/nodejs:16
EXPOSE 3000
WORKDIR /usr/src/app
CMD [ "node", "index.js" ]
COPY --from=build /usr/src/app /usr/src/app