#!/bin/bash
set -e
cd "$(dirname "$0")"
[ ! -d node_modules ] && echo "Installing dependencies..." && pnpm install
[ ! -f .env ] && echo "Creating .env from .env.example..." && cp .env.example .env
pnpm start
