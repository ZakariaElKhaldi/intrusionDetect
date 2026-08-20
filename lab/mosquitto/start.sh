#!/bin/sh
set -eu
mosquitto_passwd -b -c /tmp/mosquitto.passwd lab-device lab-password
exec mosquitto -c /mosquitto/config/mosquitto.conf
