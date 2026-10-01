---
description: "Verified local proxy route, offline native-policy checks and the successful authorized single-request network validation."
---
# Native network route repair

The research-reference implementation is complete as recorded in [repair validation](research-repair-validation.md). The remaining fetch failure comes from direct system resolution returning Clash fake-IP addresses. The existing DSH build already supports an explicit HTTP proxy. No host or plugin source change is needed for this route.

## Current evidence

Read-only inspection on 2026-09-11 matched the running Mihomo process to the active Clash Verge configuration. It declares mixed port 7897 with LAN access disabled and no proxy authentication entries. DNS uses `fake-ip` in `198.18.0.1/16`, with TUN automatic routing and DNS hijacking enabled. System proxy integration is disabled. Only allowlisted configuration fields and process identity were inspected or reported; subscription URLs, controller secrets and credentials were not exported.

A TCP connection to `127.0.0.1:7897` succeeded. The same port on `::1` refused the connection. The earlier `lsof` check returned no visible listener, which was not evidence that the IPv4 endpoint was unavailable. A successful TCP connection does not establish proxy forwarding or external HTTP success.

The historical isolated launcher's `env -i` command provides no proxy variables, and the inspection process has none. DSH therefore selected its direct, address-pinned fetch path. That path correctly rejects the fake-IP range before HTTP. This establishes a missing explicit route in the isolated launch environment, not a regression in the address guard or proof that an existing exported proxy was accidentally removed.

## Exact proposed change

For a newly authorized isolated DSH process, supply these values inside its `env -i` argument list:

```sh
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
NO_PROXY=localhost,127.0.0.1,::1
```

The DSH launcher installs the supported policy before loading plugins. A proxied domain request delegates origin resolution to the operator's local proxy; literal non-public destinations remain blocked by native fetch. Loopback remains direct. This is a deliberate process-wide routing choice: a future DSH host's model, search and other supported outbound transports would also use it. Their configured providers and models would remain unchanged.

This proposal does not modify Clash, DNS, shell startup files, the daily DSH profile, dependencies or application sources. The failed writing run, its launcher, saved limits and data remain unchanged. The environment values are not yet applied to a running DSH host.

## Prepared native probe and offline result

The Git-ignored test-only probe is `.codex/spikes/research-repair/network-probe.mjs` in the plugin checkout. It imports the actual built DSH proxy library and `HttpFetchProvider`, installs a process-local policy from the explicit test input and disposes it afterward. It mounts no Agent, model, search provider or Session and reads no saved credentials.

The following command completed with exit 0:

```sh
DSH_STORY_PROBE_PROXY=http://127.0.0.1:7897 node .codex/spikes/research-repair/network-probe.mjs --check
```

It verified HTTP and HTTPS proxy selection, direct named/IPv4/IPv6 loopback routing, native rejection of loopback/private/fake-IP literals, and restoration of the previous process-local policy. The result reported zero public fetch attempts, zero search requests and zero model requests. Node syntax validation also passed. These are local policy checks, not external connectivity evidence or a supported-profile launch test.

## Authorized single-request validation

The user explicitly allowed this proxy only in the independent verification process. On 2026-09-11, the following command ran once and exited with code 0:

```sh
DSH_STORY_PROBE_PROXY=http://127.0.0.1:7897 node .codex/spikes/research-repair/network-probe.mjs --fetch
```

The only external target was `https://www.chinawriter.com.cn/`. Native `HttpFetchProvider` issued one anonymous GET under a 15-second deadline, a 1,000,000-byte response cap, a 100,000-character decoded cap and zero redirect hops. It returned HTTP 200 with 49,864 decoded Unicode characters of HTML, without truncation. The probe made zero search and model requests, performed no retry and restored its previous process-local proxy policy before exiting. Native rejection of loopback, private and fake-IP literals also passed in that process. The [sanitized result](/private/tmp/dsh-story-research-repair/network-probe-live.json) contains status, body kind, character count, truncation state and policy checks; no page body or secrets were retained in the report.

This result establishes one public page fetch through the selected route. It does not establish search evidence adequacy, model connectivity, three-chapter generation, current reader previews or restart acceptance. No running DSH host or global network configuration was changed, and no writing task was resumed or resubmitted. The single-request authorization has been consumed; any additional external probe or new paid writing run needs its own authorization under the [live acceptance boundary](real-model-acceptance-preflight.md).

A later, explicitly authorized [real-model rerun](real-model-rerun1-validation.md) used the repaired collector and isolated proxy. Native retrieval and evidence archival succeeded, but two planned questions remained insufficient and blocked settings. No reader document was generated.
