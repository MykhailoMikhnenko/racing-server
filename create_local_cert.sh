#!/bin/bash

# Set the directory where the SSL files will be generated
SSL_DIR="$HOME/.bmlabs-ssl"
DAYS_VALID=365

while getopts ":d:" opt; do
  case $opt in
    d)
      DOMAIN=$OPTARG
      ;;
    \?)
      echo "Invalid option: -$OPTARG"
      exit 1
      ;;
    :)
      echo "Option -$OPTARG requires an argument."
      exit 1
      ;;
  esac
done

if [ -z "$DOMAIN" ]; then
  echo "Please provide a domain using the -d option."
  exit 1
fi

SSL_FULL_PATH="$SSL_DIR/$DOMAIN"

if [ -d "$SSL_FULL_PATH" ]; then
    echo "SSL certificate files already exist for $DOMAIN."
    exit 0
fi

# Create the SSL directory if it doesn't exist
mkdir -p "$SSL_FULL_PATH"

openssl_config="
[dn]
CN=$DOMAIN
[req]
distinguished_name = dn
[EXT]
subjectAltName=DNS:$DOMAIN
keyUsage=digitalSignature
extendedKeyUsage=serverAuth
"

openssl req -x509 -days "$DAYS_VALID" -out "$SSL_FULL_PATH"/server.crt -keyout "$SSL_FULL_PATH"/server.key -newkey rsa:2048 -nodes -sha256 -subj "/CN=$DOMAIN" -extensions EXT -config <(echo "$openssl_config")

chmod 644 "$SSL_FULL_PATH"/server.crt
chmod 644 "$SSL_FULL_PATH"/server.key

# Add the certificate to the system keychain
sudo security add-trusted-cert -d -r trustRoot -k "/Library/Keychains/System.keychain" "$SSL_FULL_PATH/server.crt"

# Print a summary of the generated files
echo "SSL certificate files generated successfully:"
echo "  Private Key: $SSL_FULL_PATH/server.key"
echo "  Certificate: $SSL_FULL_PATH/server.crt"
