# Portable live IoT cyber range

This presentation lab produces real packets on an isolated Linux bridge and has
Suricata inspect them. It is a controlled cyber range, not evidence that the
RT-IoT2022 model generalizes to a production network.

## Supported host contract

- Native Linux on Arch, NixOS, or Fedora.
- Rootful Docker Engine and Docker Compose v2.
- `x86_64` or `aarch64`.
- Not Docker Desktop, rootless Docker, or Podman for this release.

Fedora installation is documented by [Docker](https://docs.docker.com/engine/install/fedora/).
On Arch, install `docker` and `docker-compose`, then enable `docker.service`.
On NixOS, add the equivalent of the following and rebuild before the rehearsal:

```nix
{
  virtualisation.docker.enable = true;
  environment.systemPackages = with pkgs; [ docker-compose ];
  users.users.YOUR_USER.extraGroups = [ "docker" ];
}
```

## Presentation commands

```bash
make lab-preflight
make lab-up
make lab-normal
make lab-scan
make lab-mqtt-attack
make lab-web-attack
make lab-status
make lab-down
```

If those ports are occupied during a rehearsal, use explicit alternatives
without changing the presentation defaults:

```bash
IOT_IDS_FRONTEND_PORT=15173 IOT_IDS_BACKEND_PORT=18000 make lab-up
```

`lab-up` creates only the labelled internal `iotlab` bridge with the fixed host
interface `iotlab0`. The attacker has no Internet route, no host network, no
Docker socket, and no Linux capabilities. Suricata alone receives the documented
`NET_ADMIN`, `NET_RAW`, and `SYS_NICE` capture capabilities and is told to inspect
only `iotlab0`.

The dashboard login for this disposable lab is `admin` / `sentinel-demo`. Sensor
ingestion uses an independent random token generated under `.lab/runtime.env`.
`lab-preflight` never creates or changes host configuration; on a new checkout,
`lab-up` creates the project-local credentials and cached pinned Suricata config,
then runs the same checks before starting services.

## Offline rehearsal

While online, run `make lab-bundle`. Copy the repository including `.lab/bundle`
to the presentation machine, then run `make lab-load-bundle` and
`make lab-preflight`. The bundle includes every image, the exact rule file, image
identities, and SHA-256 verification. Rehearse a clean `lab-reset`, all three
scenarios, an agent restart, and `lab-down` on the exact presentation OS at least
one day before presenting.
