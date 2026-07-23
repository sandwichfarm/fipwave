#!/bin/sh
# This script owns only fips-preflight0. It refuses to reuse an existing
# interface and deletes only the interface it created in this invocation.
set -eu

IP_BIN=${IP_BIN:-ip}
TUN_DEVICE=${TUN_DEVICE:-/dev/net/tun}
INTERFACE=fips-preflight0
IPV6_ADDRESS=fd42:6677:6677::1/64
IMAGE=alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c

owned=0
interface_created=not_run
ipv6_assigned=not_run
cleanup_complete=not_run
failure=''

emit_evidence() {
  exit_status=$1
  if [ "$exit_status" -eq 0 ] && [ "$interface_created" = passed ] && [ "$ipv6_assigned" = passed ] && [ "$cleanup_complete" = passed ]; then
    status=passed
    errors='[]'
  else
    status=failed
    if [ -n "$failure" ]; then errors="[\"$failure\"]"; else errors='["lifecycle_failed"]'; fi
  fi
  printf '%s\n' "{\"schemaVersion\":1,\"source\":\"lifecycle\",\"status\":\"$status\",\"image\":\"$IMAGE\",\"interfaceName\":\"$INTERFACE\",\"ipv6Address\":\"$IPV6_ADDRESS\",\"authorities\":{\"devices\":[\"/dev/net/tun\"],\"capabilities\":[\"NET_ADMIN\"],\"securityOptions\":[\"no-new-privileges:true\"],\"privileged\":false,\"networkMode\":\"none\",\"publishedPorts\":[]},\"checks\":{\"imagePinned\":\"not_run\",\"tunDevice\":\"not_run\",\"netAdmin\":\"not_run\",\"noNewPrivileges\":\"not_run\",\"notPrivileged\":\"not_run\",\"sysAdminAbsent\":\"not_run\",\"hostNetworkAbsent\":\"not_run\",\"loopbackPortsOnly\":\"not_run\",\"interfaceCreated\":\"$interface_created\",\"ipv6Assigned\":\"$ipv6_assigned\",\"cleanupComplete\":\"$cleanup_complete\"},\"errors\":$errors}"
}

cleanup() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  if [ "$owned" -eq 1 ]; then
    if "$IP_BIN" link delete dev "$INTERFACE"; then
      cleanup_complete=passed
    else
      cleanup_complete=failed
      failure=owned_cleanup_failed
    fi
  fi
  emit_evidence "$exit_status"
  exit "$exit_status"
}

trap cleanup EXIT HUP INT TERM

if [ ! -c "$TUN_DEVICE" ]; then
  failure=tun_device_unavailable
  interface_created=failed
  exit 1
fi

if "$IP_BIN" link show dev "$INTERFACE" >/dev/null 2>&1; then
  failure=interface_already_exists
  interface_created=failed
  exit 1
fi

failure=interface_create_failed
"$IP_BIN" tuntap add dev "$INTERFACE" mode tun
owned=1
interface_created=passed

failure=ipv6_assignment_failed
"$IP_BIN" -6 addr add "$IPV6_ADDRESS" dev "$INTERFACE"
ipv6_assigned=passed

failure=interface_up_failed
"$IP_BIN" link set dev "$INTERFACE" up

"$IP_BIN" -details link show dev "$INTERFACE"
"$IP_BIN" -6 addr show dev "$INTERFACE"
failure=''
