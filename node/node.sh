#!/usr/bin/env bash

if [[ ! -d /data/node ]]; then
  mkdir -p /data/node
fi

if [[ ! -f /data/node/neurai.conf ]]; then
echo -e "Creating config file..."
mkdir /data > /dev/null 2>&1
mkdir /data/node > /dev/null 2>&1
touch /data/node/neurai.conf
cat <<- EOF > /data/node/neurai.conf
rpcuser=${NEURAI_RPC_USER:-NeuraiDockerUser}
rpcpassword=${NEURAI_RPC_PASS:-NeuraiDockerPassword}
listen=0
daemon=0
server=1
txindex=1
assetindex=1
addressindex=1
timestampindex=1
spentindex=1
rest=1
dbcache=128
rpcworkqueue=${NEURAI_RPC_WORKQUEUE:-256}
rpcthreads=${NEURAI_RPC_THREADS:-16}
rpcallowip=0.0.0.0/0
disablewallet=1
rpcbind=0.0.0.0
rpcservertimeout=240
EOF
fi

bash -c "neuraid -datadir=/data/node"
