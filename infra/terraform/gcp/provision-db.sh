#!/bin/bash
set -e

DB_NAME="${1:-customer}"
DB_USER="${2:-customer_app}"
DB_PASS="${3:-BankUsacSecurePassword2026}"

echo ">>> Instalando PostgreSQL..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-contrib

echo ">>> Configurando PostgreSQL..."
PG_CONF=$(find /etc/postgresql/ -name postgresql.conf | head -n 1)
PG_HBA=$(find /etc/postgresql/ -name pg_hba.conf | head -n 1)

sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"
sed -i "s/listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"

if ! grep -q "10.0.0.0/8" "$PG_HBA"; then
  echo "host    all             all             10.0.0.0/8            md5" >> "$PG_HBA"
fi

if ! grep -q "127.0.0.1/32" "$PG_HBA"; then
  echo "host    all             all             127.0.0.1/32          md5" >> "$PG_HBA"
fi

systemctl restart postgresql
systemctl enable postgresql

echo ">>> Creando usuario $DB_USER y base de datos $DB_NAME..."
sudo -u postgres psql -v ON_ERROR_STOP=1 <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
      CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';
    ELSE
      ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';
    END IF;
  END
  \$\$;

  SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

  GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOSQL

echo ">>> Base de datos $DB_NAME lista y operativa!"
