#!/bin/bash

prisma migrate deploy

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
node server.js
