#!/bin/sh
# -f: fail on HTTP 4xx/5xx; --max-time: avoid hanging healthcheck
exec curl -fsS --max-time 5 "http://127.0.0.1:3000/health"
