#!/usr/bin/env bash
# Makes the HTTPS certificate for TelemuneSmartAi: certs/server.crt + certs/server.key (valid 825 days).
# It covers localhost, this computer's name and every IPv4 address it has right now, so other computers can open
# https://<this machine's IP>:8443 and use the microphone (browsers allow the mic only on https or localhost).
#
#   ./scripts/make-cert.sh          make it (keeps an existing one that still covers this machine's IPs)
#   ./scripts/make-cert.sh --force  make a new one (e.g. after the IP address changed)
#
# The certificate is self-signed: the first visit shows a warning ("Your connection is not private") →
# Advanced → Proceed. To remove the warning, install certs/server.crt as trusted on each computer (see the guide).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v openssl >/dev/null 2>&1 || { echo "openssl is needed to make the HTTPS certificate." >&2; exit 1; }
mkdir -p certs

# This machine's IPv4 addresses (not 127.x)
ips() {
  if command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '/inet / && $2 !~ /^127\./ { sub("addr:", "", $2); print $2 }'
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -v '^127\.'
  fi | sort -u
}

# Keep the current certificate when it already covers every address (unless --force)
if [ "${1:-}" != "--force" ] && [ -f certs/server.crt ] && [ -f certs/server.key ]; then
  have="$(openssl x509 -in certs/server.crt -noout -text 2>/dev/null | tr ',' '\n' | sed -n 's/.*IP Address:\(.*\)/\1/p' | tr -d ' ')"
  missing=""
  for ip in $(ips); do echo "$have" | grep -qx "$ip" || missing="$missing $ip"; done
  if [ -z "$missing" ]; then echo "HTTPS certificate is up to date (certs/server.crt)."; exit 0; fi
  echo "The certificate doesn't cover:$missing — making a new one."
fi

host="$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname)"
san="DNS:localhost,IP:127.0.0.1"
# the computer's name too (skipped when it is only digits, e.g. a name taken from an IP)
if [[ "$host" =~ [A-Za-z] ]]; then san="${san},DNS:${host},DNS:${host}.local"; fi
for ip in $(ips); do san="${san},IP:${ip}"; done

cfg="$(mktemp)"
trap 'rm -f "$cfg"' EXIT
cat > "$cfg" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = TelemuneSmartAi (${host})
O = Telemune
[ext]
subjectAltName = ${san}
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout certs/server.key -out certs/server.crt -config "$cfg" >/dev/null 2>&1
chmod 600 certs/server.key
echo "Made certs/server.crt for: ${san//,/ }"
